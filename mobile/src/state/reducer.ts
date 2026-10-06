import type {
  Category,
  Product,
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
import { restockPurchased, upsertInventory } from './inventory';
import { CATEGORY_ORDER, mergeIntoDraft, pendingItems, visibleItems } from './planner';
import { extractItemName, newProduct } from './catalog';
import { clock, uid } from './eventClock';

export type Action =
  | { type: 'HYDRATE'; payload: HouseholdState }
  | { type: 'ADD_TURN'; turn: Turn }
  /** `by`: the member using this phone — new list rows and purchases are tagged with it. */
  | { type: 'APPLY_AI'; response: AIResponse; by?: string }
  | { type: 'MARK_PURCHASED_BY_ID'; itemId: string; by?: string }
  | { type: 'REMOVE_ITEM'; itemId: string }
  | { type: 'SET_INVENTORY'; update: InventoryUpdate }
  | { type: 'SAVE_AS_USUAL'; fields: UsualFields }
  | { type: 'FORGET_PREFERENCE'; productId: string }
  | { type: 'FORGET_ALIAS_PREFERENCE'; disambiguationGroup: string }
  | { type: 'APPROVE_LIST' }
  /** Mom tapped Add on a suggestion — a pantry restock (planner `lowStockProposals`) or a purchase prediction (plan_10). */
  | { type: 'ACCEPT_RESTOCK'; proposal: ProposedItem; by?: string }
  | { type: 'DISMISS_RESTOCK'; productId: string }
  | { type: 'DISMISS_PREDICTION'; productId: string }
  /** Mom moved a product to another category (Item Detail). Sticks for this household. */
  | { type: 'SET_PRODUCT_CATEGORY'; productId: string; category: Category }
  /** Mom filled in "Add item" herself (AddItemSheet). Every field is hers — nothing to ask. */
  | { type: 'ADD_ITEM'; item: ManualItem; by?: string }
  | { type: 'RESET' };

export interface ManualItem {
  /** A catalog product, or a new one filed in the section Mom tapped. */
  product: Product;
  qty: number;
  unit: string;
  brand: string | null;
  variant: string | null;
  /** She picked the kind out of a group ("surf excel" → powder) — that's her household default now. */
  chosenFromGroup?: string;
  /** She tapped the amount pre-filled from memory, which confirms it. */
  usedUsualQty?: boolean;
}

export { uid } from './eventClock';

/** New rows get `by`; a row that was already there keeps whoever added it first, even when refined. */
function stampAdder(before: ListItem[], after: ListItem[], by: string | undefined): ListItem[] {
  if (!by) return after;
  const prior = new Map(before.map((li) => [li.id, li.addedByMemberId]));
  return after.map((li) => {
    const addedByMemberId = prior.has(li.id) ? prior.get(li.id) : by;
    return li.addedByMemberId === addedByMemberId ? li : { ...li, addedByMemberId };
  });
}

/** Plan the proposals into the list; any addition reopens an approved list as a draft (plan_08). */
function addToList(state: HouseholdState, proposed: ProposedItem[], by?: string): Pick<HouseholdState, 'listItems' | 'list'> {
  if (!proposed.length) return { listItems: state.listItems, list: state.list };
  const merged = mergeIntoDraft(state.listItems, proposed, state.products, () => uid('it'));
  return {
    listItems: stampAdder(state.listItems, merged, by),
    list: state.list.status === 'approved' ? { ...state.list, status: 'draft' } : state.list,
  };
}

/** Hide a pantry suggestion until the pantry row changes again. */
function dismissRestock(state: HouseholdState, inventory: HouseholdState['inventory'], productId: string) {
  const row = inventory.find((i) => i.productId === productId);
  return row ? { ...state.dismissedRestocks, [productId]: row.updatedAt } : state.dismissedRestocks;
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

/** Append purchases to history, fold each into household memory, and restock the pantry (all confirmed actions). */
function recordPurchases(
  state: HouseholdState, items: ListItem[], now: Date, by?: string,
): Pick<HouseholdState, 'history' | 'preferences' | 'inventory'> {
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
      ...(by ? { memberId: by } : {}),
    });
  }
  return {
    history: [...rows, ...state.history],
    preferences,
    inventory: restockPurchased(state.inventory, items.map((li) => li.productId), now),
  };
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
    const latest = visibleItems(state.listItems).reverse().find((li) => li.productId === answered.productId);
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

  // "Add rice to the list? — Yes, 5 kg": taking the remembered amount confirms it. "Not now" says nothing about memory.
  if (answered?.kind === 'restock' && answered.suggestedOption && answered.productId && chosen === answered.suggestedOption) {
    preferences = confirmPreference(preferences, answered.productId, now);
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

/**
 * "Where does Harpic go? — Cleaning": file the new product and its name in the
 * catalog, so the item lands in that section now and every time after. Only on
 * Mom's answer — the AI's keyword guess alone never reaches the catalog.
 */
function learnCatalog(state: HouseholdState, r: AIResponse): Pick<HouseholdState, 'products' | 'aliases'> {
  const { products, aliases } = state;
  const answered = state.pendingClarifications.find((c) => c.id === r.resolvedClarificationId);
  const category = CATEGORY_ORDER.find((c) => c === r.chosenOption);
  const name = answered?.kind === 'category' ? extractItemName(answered.itemRawText) : null;
  if (!category || !name) return { products, aliases };
  const product = newProduct(name, category);
  const alias = name.toLowerCase();
  return {
    products: [...products.filter((p) => p.id !== product.id), product],
    aliases: aliases.some((a) => a.alias === alias) ? aliases : [...aliases, { alias, productId: product.id }],
  };
}

/** "Add item": file a new product if needed, put the row on the list, and learn only what she picked. */
function addManualItem(state: HouseholdState, m: ManualItem, by?: string): HouseholdState {
  const now = clock();
  const known = state.products.some((p) => p.id === m.product.id);
  const alias = m.product.name.toLowerCase();
  const products = known ? state.products : [...state.products, m.product];
  const aliases = known || state.aliases.some((a) => a.alias === alias)
    ? state.aliases
    : [...state.aliases, { alias, productId: m.product.id }];
  const said = [`${m.qty} ${m.unit}`, m.brand, m.variant].filter(Boolean).join(', ');
  const proposal: ProposedItem = {
    id: uid('it'),
    productId: m.product.id,
    product: m.product.name,
    category: m.product.category,
    qty: m.qty,
    unit: m.unit,
    brand: m.brand,
    variant: m.variant,
    confidence: 'high',
    source: 'user',
    rationale: `You added this yourself: ${said}.`,
    needsConfirmation: false,
  };
  return {
    ...state,
    products,
    aliases,
    ...addToList({ ...state, products }, [proposal], by),
    preferences: m.usedUsualQty ? confirmPreference(state.preferences, m.product.id, now) : state.preferences,
    aliasPreferences: m.chosenFromGroup ? chooseAlias(state.aliasPreferences, m.chosenFromGroup, m.product.id, now) : state.aliasPreferences,
  };
}

/** Move a product — and every row of it on the list — to Mom's category. */
function setProductCategory(state: HouseholdState, productId: string, category: Category): HouseholdState {
  if (!state.products.some((p) => p.id === productId)) return state;
  return {
    ...state,
    products: state.products.map((p) => (p.id === productId ? { ...p, category } : p)),
    listItems: state.listItems.map((li) => (li.productId === productId ? { ...li, category } : li)),
    categoryOverrides: { ...state.categoryOverrides, [productId]: category },
  };
}

export function reducer(state: HouseholdState, action: Action): HouseholdState {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;
    case 'ADD_TURN':
      return { ...state, turns: [...state.turns, action.turn] };
    case 'APPLY_AI': {
      const r = action.response;
      const now = clock();
      // Before planning, so an item filed this turn is categorized from the catalog like any other.
      const catalog = learnCatalog(state, r);
      const corrected = new Set((r.corrections ?? []).map((c) => c.itemId));
      // A corrected item is swapped out, not merged into: soft-remove it before planning the replacement.
      const withoutCorrected = state.listItems.map((li) => (corrected.has(li.id) ? { ...li, status: 'removed' as const } : li));
      const { list, listItems: planned } = addToList({ ...state, ...catalog, listItems: withoutCorrected }, r.proposedItems, action.by);
      let listItems = planned;
      // Inventory updates
      let inventory = state.inventory;
      for (const u of r.inventoryUpdates) inventory = upsertInventory(inventory, u, now);

      const answered = state.pendingClarifications.find((c) => c.id === r.resolvedClarificationId);
      const dismissedRestocks = answered?.kind === 'restock' && answered.productId && r.chosenOption === 'Not now'
        ? dismissRestock(state, inventory, answered.productId)
        : state.dismissedRestocks;

      const learned = learnFromTurn(state, r, now);
      let { history } = state;
      let { preferences } = learned;
      if (r.purchasesMarked.length) {
        listItems = listItems.map((li) => (r.purchasesMarked.includes(li.id) ? { ...li, status: 'purchased' as const } : li));
        const bought = listItems.filter((li) => r.purchasesMarked.includes(li.id));
        ({ history, preferences, inventory } = recordPurchases({ ...state, preferences, inventory }, bought, now, action.by));
      }
      const pendingClarifications = mergePending(state.pendingClarifications, r);

      return {
        ...state, ...catalog, list, listItems, inventory, history, pendingClarifications, preferences, dismissedRestocks,
        aliasPreferences: learned.aliasPreferences,
      };
    }
    case 'MARK_PURCHASED_BY_ID': {
      const item = state.listItems.find((li) => li.id === action.itemId);
      if (!item || item.status !== 'pending') return state;
      // Ticking items off an approved list is shopping, not editing — the list stays approved.
      return {
        ...state,
        listItems: state.listItems.map((li) => (li.id === action.itemId ? { ...li, status: 'purchased' } : li)),
        ...recordPurchases(state, [item], clock(), action.by),
      };
    }
    case 'REMOVE_ITEM':
      // Soft: kept for audit, hidden from the list view. A bought row can go too —
      // its purchase stays in history, only the list line is cleared.
      return {
        ...state,
        listItems: state.listItems.map((li) => (li.id === action.itemId ? { ...li, status: 'removed' } : li)),
      };
    case 'SET_INVENTORY':
      return { ...state, inventory: upsertInventory(state.inventory, action.update, clock()) };
    case 'SAVE_AS_USUAL':
      return { ...state, preferences: saveAsUsual(state.preferences, action.fields, clock()) };
    case 'FORGET_PREFERENCE':
      return { ...state, preferences: state.preferences.filter((p) => p.productId !== action.productId) };
    case 'FORGET_ALIAS_PREFERENCE':
      return {
        ...state,
        aliasPreferences: state.aliasPreferences.filter((a) => a.disambiguationGroup !== action.disambiguationGroup),
      };
    case 'APPROVE_LIST':
      if (state.list.status === 'approved' || pendingItems(state.listItems).length === 0) return state;
      return { ...state, list: { ...state.list, status: 'approved' } };
    case 'ACCEPT_RESTOCK': {
      const p = action.proposal;
      if (pendingItems(state.listItems).some((li) => li.productId === p.productId)) return state;
      // Taking the remembered amount is picking the remembered option — same as the chat restock chip.
      const preferences = p.source === 'household_memory' && p.qty != null
        ? confirmPreference(state.preferences, p.productId, clock())
        : state.preferences;
      return { ...state, ...addToList(state, [{ ...p, id: uid('it'), needsConfirmation: false }], action.by), preferences };
    }
    case 'DISMISS_RESTOCK':
      return { ...state, dismissedRestocks: dismissRestock(state, state.inventory, action.productId) };
    case 'DISMISS_PREDICTION':
      return { ...state, dismissedPredictions: { ...state.dismissedPredictions, [action.productId]: clock().toISOString() } };
    case 'SET_PRODUCT_CATEGORY':
      return setProductCategory(state, action.productId, action.category);
    case 'ADD_ITEM':
      return addManualItem(state, action.item, action.by);
    case 'RESET':
      return initialHouseholdState;
    default:
      return state;
  }
}

export function buildChatContext(state: HouseholdState, answeringClarificationId?: string): ChatContext {
  return {
    recentItems: visibleItems(state.listItems).slice(-10),
    preferences: state.preferences,
    aliasPreferences: state.aliasPreferences,
    inventory: state.inventory,
    draftList: pendingItems(state.listItems),
    listStatus: state.list.status,
    pendingClarifications: state.pendingClarifications,
    products: state.products,
    aliases: state.aliases,
    history: state.history,
    answeringClarificationId,
  };
}
