import type {
  ChatContext,
  Clarification,
  HouseholdState,
  InventoryUpdate,
  ListItem,
  ProposedItem,
  Purchase,
  Turn,
  AIResponse,
} from '../types';
import { initialHouseholdState } from '../data/seed';
import {
  applyPurchase,
  chooseAlias,
  confirmPreference,
  correctAlias,
  overridePreference,
  saveAsUsual,
  type UsualFields,
} from './memory';

export type Action =
  | { type: 'HYDRATE'; payload: HouseholdState }
  | { type: 'ADD_TURN'; turn: Turn }
  | { type: 'APPLY_AI'; response: AIResponse }
  | { type: 'MARK_PURCHASED_BY_ID'; itemId: string }
  | { type: 'REMOVE_ITEM'; itemId: string }
  | { type: 'SET_INVENTORY'; update: InventoryUpdate }
  | { type: 'SAVE_AS_USUAL'; fields: UsualFields }
  | { type: 'FORGET_PREFERENCE'; productId: string }
  | { type: 'FORGET_ALIAS_PREFERENCE'; disambiguationGroup: string }
  | { type: 'APPROVE_LIST' }
  | { type: 'RESET' };

let _c = 0;
export const uid = (p: string) => `${p}_${Date.now()}_${_c++}`;

function upsertInventory(list: HouseholdState['inventory'], u: InventoryUpdate): HouseholdState['inventory'] {
  const idx = list.findIndex((i) => i.productId === u.productId);
  const next: HouseholdState['inventory'] = [...list];
  if (idx >= 0) next[idx] = { ...next[idx], ...u };
  else next.push({ productId: u.productId, state: u.state, approxQty: u.approxQty, approxUnit: u.approxUnit });
  return next;
}

function proposedToListItem(p: ProposedItem): ListItem {
  return {
    id: p.id,
    productId: p.productId,
    product: p.product,
    category: p.category,
    qty: p.qty,
    unit: p.unit,
    brand: p.brand,
    variant: p.variant,
    confidence: p.confidence,
    source: p.source,
    rationale: p.rationale,
    purchased: false,
  };
}

const clarKey = (c: Clarification) => `${c.kind}|${c.productId ?? ''}|${c.itemRawText.toLowerCase().trim()}`;

/**
 * Pending clarifications carry across turns (plan_04): the answered one is
 * dropped, new ones are appended, and an unrelated request leaves the rest
 * pending so their chips stay tappable. A new question about the same thing
 * (same kind + item) supersedes the older one.
 */
export function mergePending(prior: Clarification[], r: AIResponse): Clarification[] {
  const incoming = new Set(r.clarifications.map(clarKey));
  const incomingIds = new Set(r.clarifications.map((c) => c.id));
  const kept = prior.filter(
    (c) => c.id !== r.resolvedClarificationId && !incomingIds.has(c.id) && !incoming.has(clarKey(c)),
  );
  return [...kept, ...r.clarifications];
}

/** Append purchases to history and fold each into household memory (a confirmed action). */
function recordPurchases(state: HouseholdState, items: ListItem[], now: Date): Pick<HouseholdState, 'history' | 'preferences'> {
  let preferences = state.preferences;
  const rows: Purchase[] = [];
  for (const li of items) {
    const previous = state.history
      .filter((h) => h.productId === li.productId)
      .reduce<string | undefined>((latest, h) => (!latest || h.purchasedAt > latest ? h.purchasedAt : latest), undefined);
    preferences = applyPurchase(preferences, li, previous, now);
    rows.push({
      id: uid('h'),
      productId: li.productId,
      product: li.product,
      qty: li.qty,
      unit: li.unit,
      brand: li.brand,
      purchasedAt: now.toISOString(),
    });
  }
  return { history: [...rows, ...state.history], preferences };
}

export const disambiguationGroupOf = (state: Pick<HouseholdState, 'aliases'>, productId: string) =>
  state.aliases.find((a) => a.productId === productId && a.disambiguationGroup)?.disambiguationGroup;

/**
 * Gated memory writes for one turn (plan_05). Memory changes only when the user
 * answered a question or corrected an item — never from what the AI proposed on
 * its own.
 */
function learnFromTurn(state: HouseholdState, r: AIResponse, now: Date): Pick<HouseholdState, 'preferences' | 'aliasPreferences'> {
  let { preferences, aliasPreferences } = state;
  const answered = state.pendingClarifications.find((c) => c.id === r.resolvedClarificationId);
  const chosen = r.chosenOption;

  if (answered?.kind === 'save_pref' && answered.productId && chosen?.startsWith('Yes')) {
    const latest = state.listItems.slice().reverse().find((li) => li.productId === answered.productId);
    if (latest?.qty && latest.unit) {
      preferences = saveAsUsual(preferences, {
        productId: latest.productId,
        preferredBrand: latest.brand ?? undefined,
        preferredVariant: latest.variant ?? undefined,
        typicalQty: latest.qty,
        typicalUnit: latest.unit,
      }, now);
    }
  }

  if (answered?.kind === 'product_type' && chosen) {
    const product = state.products.find((p) => p.name === chosen);
    const group = product && disambiguationGroupOf(state, product.id);
    if (product && group) aliasPreferences = chooseAlias(aliasPreferences, group, product.id, now);
  }

  // A quantity question pre-filled from memory: the pre-filled chip confirms, anything else overrides.
  if (answered?.kind === 'quantity' && answered.suggestedOption && answered.productId && r.proposedItems.length) {
    preferences = chosen === answered.suggestedOption
      ? confirmPreference(preferences, answered.productId, now)
      : overridePreference(preferences, answered.productId);
  }

  for (const c of r.corrections ?? []) {
    if (c.disambiguationGroup) aliasPreferences = correctAlias(aliasPreferences, c.disambiguationGroup, c.productId, now);
  }

  return { preferences, aliasPreferences };
}

export function reducer(state: HouseholdState, action: Action): HouseholdState {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;
    case 'ADD_TURN':
      return { ...state, turns: [...state.turns, action.turn] };
    case 'APPLY_AI': {
      const r = action.response;
      const now = new Date();
      const corrected = new Set((r.corrections ?? []).map((c) => c.itemId));
      let listItems = state.listItems.filter((li) => !corrected.has(li.id));
      // Merge proposed items (dedupe by productId+brand — replace)
      if (r.proposedItems.length) {
        const additions = r.proposedItems.map(proposedToListItem);
        const remaining = listItems.filter(
          (li) => !additions.some((a) => a.productId === li.productId && !li.purchased),
        );
        listItems = [...remaining, ...additions];
      }
      // Inventory updates
      let inventory = state.inventory;
      for (const u of r.inventoryUpdates) inventory = upsertInventory(inventory, u);

      const learned = learnFromTurn(state, r, now);
      let { history } = state;
      let { preferences } = learned;
      if (r.purchasesMarked.length) {
        listItems = listItems.map((li) => (r.purchasesMarked.includes(li.id) ? { ...li, purchased: true } : li));
        const bought = listItems.filter((li) => r.purchasesMarked.includes(li.id));
        ({ history, preferences } = recordPurchases({ ...state, preferences }, bought, now));
      }
      const pendingClarifications = mergePending(state.pendingClarifications, r);

      return {
        ...state, listItems, inventory, history, pendingClarifications, preferences,
        aliasPreferences: learned.aliasPreferences,
      };
    }
    case 'MARK_PURCHASED_BY_ID': {
      const item = state.listItems.find((li) => li.id === action.itemId);
      if (!item || item.purchased) return state;
      return {
        ...state,
        listItems: state.listItems.map((li) => (li.id === action.itemId ? { ...li, purchased: true } : li)),
        ...recordPurchases(state, [item], new Date()),
      };
    }
    case 'REMOVE_ITEM':
      return { ...state, listItems: state.listItems.filter((li) => li.id !== action.itemId) };
    case 'SET_INVENTORY':
      return { ...state, inventory: upsertInventory(state.inventory, action.update) };
    case 'SAVE_AS_USUAL':
      return { ...state, preferences: saveAsUsual(state.preferences, action.fields, new Date()) };
    case 'FORGET_PREFERENCE':
      return { ...state, preferences: state.preferences.filter((p) => p.productId !== action.productId) };
    case 'FORGET_ALIAS_PREFERENCE':
      return {
        ...state,
        aliasPreferences: state.aliasPreferences.filter((a) => a.disambiguationGroup !== action.disambiguationGroup),
      };
    case 'APPROVE_LIST':
      // In sandbox, "approve" freezes the current list; here we just move all unpurchased to purchased? No — keep as-is.
      return state;
    case 'RESET':
      return initialHouseholdState;
    default:
      return state;
  }
}

export function buildChatContext(state: HouseholdState, answeringClarificationId?: string): ChatContext {
  return {
    recentItems: state.listItems.slice(-10),
    preferences: state.preferences,
    aliasPreferences: state.aliasPreferences,
    inventory: state.inventory,
    draftList: state.listItems.filter((li) => !li.purchased),
    pendingClarifications: state.pendingClarifications,
    products: state.products,
    aliases: state.aliases,
    history: state.history,
    answeringClarificationId,
  };
}
