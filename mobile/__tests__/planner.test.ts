import { MockAIService } from '../src/services/MockAIService';
import { buildChatContext, reducer } from '../src/state/reducer';
import { migrateState } from '../src/state/migrate';
import {
  CATEGORY_ORDER,
  DEFAULT_RATIONALE,
  categorize,
  groupByCategory,
  lowStockProposals,
  mergeIntoDraft,
  mergeQty,
  pendingItems,
  visibleItems,
} from '../src/state/planner';
import { initialHouseholdState, seedProducts } from '../src/data/seed';
import type { Category, HouseholdState, InventoryEntry, ListItem, ProposedItem } from '../src/types';

const ai = new MockAIService();
const NOW = new Date('2026-09-27T10:00:00Z');
const EARLIER = '2026-09-01T10:00:00Z';

async function say(state: HouseholdState, text: string, clarificationId?: string) {
  const r = await ai.chat(text, buildChatContext(state, clarificationId));
  return { r, state: reducer(state, { type: 'APPLY_AI', response: r }) };
}

let n = 0;
const makeId = () => `new_${n++}`;

function proposal(productId: string, qty: number | null, unit: string | null, extra: Partial<ProposedItem> = {}): ProposedItem {
  const p = seedProducts.find((x) => x.id === productId)!;
  return {
    id: `p_${n++}`, productId, product: p.name, category: p.category, qty, unit, brand: null, variant: null,
    confidence: 'high', source: 'user', rationale: `You said ${qty} ${unit}.`, needsConfirmation: false, ...extra,
  };
}

const plan = (items: ListItem[], ...ps: ProposedItem[]) => mergeIntoDraft(items, ps, seedProducts, makeId);
const rows = (items: ListItem[]) => visibleItems(items).map((i) => [i.product, i.qty, i.unit]);

describe('dedupe against the draft', () => {
  test('tomatoes 1 kg twice → one row, 2 kg', () => {
    const items = plan([], proposal('p_tomato', 1, 'kg'), proposal('p_tomato', 1, 'kg'));
    expect(rows(items)).toEqual([['Tomatoes', 2, 'kg']]);
    expect(items[0].rationale).toBe('You said 1 kg. Then you added 1 kg more.');
  });

  test('1 kg + 500 g → 1.5 kg (conversion table bridges the units)', () => {
    expect(rows(plan([], proposal('p_tomato', 1, 'kg'), proposal('p_tomato', 500, 'g')))).toEqual([['Tomatoes', 1.5, 'kg']]);
    expect(rows(plan([], proposal('p_tomato', 500, 'g'), proposal('p_tomato', 1, 'kg')))).toEqual([['Tomatoes', 1.5, 'kg']]);
  });

  test('cross-unit sums below the big unit stay small; volumes work too', () => {
    expect(mergeQty({ qty: 0.2, unit: 'kg' }, { qty: 300, unit: 'g' })).toEqual({ qty: 500, unit: 'g' });
    expect(mergeQty({ qty: 500, unit: 'ml' }, { qty: 1, unit: 'L' })).toEqual({ qty: 1.5, unit: 'L' });
    expect(mergeQty({ qty: 0.1, unit: 'kg' }, { qty: 0.2, unit: 'kg' })).toEqual({ qty: 0.3, unit: 'kg' });
  });

  test('units the table can’t bridge → two rows (no cross-unit guessing)', () => {
    expect(rows(plan([], proposal('p_biscuits', 1, 'pack'), proposal('p_biscuits', 200, 'g'))))
      .toEqual([['Biscuits', 1, 'pack'], ['Biscuits', 200, 'g']]);
    expect(rows(plan([], proposal('p_milk', 1, 'L'), proposal('p_milk', 500, 'g')))).toHaveLength(2);
  });

  test('an unknown qty is never summed', () => {
    expect(mergeQty({ qty: null, unit: null }, { qty: 1, unit: 'kg' })).toBeNull();
    expect(rows(plan([], proposal('p_rice', null, null), proposal('p_rice', 5, 'kg')))).toHaveLength(2);
  });

  test('different brand or variant → separate rows', () => {
    const items = plan([],
      proposal('p_rice', 5, 'kg', { brand: 'Aashirvaad' }),
      proposal('p_rice', 5, 'kg', { brand: 'India Gate' }),
      proposal('p_rice', 5, 'kg', { brand: 'Aashirvaad', variant: 'Basmati' }));
    expect(items).toHaveLength(3);
  });

  test('merged row keeps the lower confidence', () => {
    const items = plan([], proposal('p_tomato', 1, 'kg'), proposal('p_tomato', 1, 'kg', { confidence: 'medium' }));
    expect(items[0].confidence).toBe('medium');
  });

  test('purchased and removed rows are history, not merge targets', () => {
    const bought = plan([], proposal('p_tomato', 1, 'kg')).map((i) => ({ ...i, status: 'purchased' as const }));
    const items = plan(bought, proposal('p_tomato', 1, 'kg'));
    expect(items.map((i) => [i.qty, i.status])).toEqual([[1, 'purchased'], [1, 'pending']]);
  });

  test('a proposal reusing a pending item’s id refines it (replace, not sum)', () => {
    const first = proposal('p_tomato', 1, 'kg', { source: 'household_memory', confidence: 'medium' });
    const items = plan(plan([], first), { ...proposal('p_tomato', 2, 'kg'), id: first.id });
    expect(rows(items)).toEqual([['Tomatoes', 2, 'kg']]);
    expect(items[0]).toMatchObject({ id: first.id, source: 'user', confidence: 'high' });
  });

  test('an id taken by a non-pending row gets a fresh one', () => {
    const first = proposal('p_tomato', 1, 'kg');
    const bought = plan([], first).map((i) => ({ ...i, status: 'purchased' as const }));
    const items = plan(bought, { ...first, qty: 2 });
    expect(items[1].id).not.toBe(first.id);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  test('missing rationale gets the default', () => {
    expect(plan([], proposal('p_onion', 1, 'kg', { rationale: '  ' }))[0].rationale).toBe(DEFAULT_RATIONALE);
  });
});

describe('categorize: catalog only', () => {
  test.each<[string, Category]>([
    ['p_tomato', 'Vegetables'], ['p_onion', 'Vegetables'], ['p_coriander_leaves', 'Vegetables'], ['p_ginger', 'Vegetables'],
    ['p_banana', 'Fruits'], ['p_lemon', 'Fruits'],
    ['p_milk', 'Dairy'], ['p_curd', 'Dairy'], ['p_paneer', 'Dairy'], ['p_bread', 'Dairy'],
    ['p_rice', 'Rice & Grains'], ['p_wheat_atta', 'Rice & Grains'], ['p_poha', 'Rice & Grains'],
    ['p_toor_dal', 'Pulses'], ['p_rajma', 'Pulses'],
    ['p_coriander_seeds', 'Spices'], ['p_turmeric', 'Spices'],
    ['p_sunflower_oil', 'Cooking Essentials'], ['p_ghee', 'Cooking Essentials'], ['p_salt', 'Cooking Essentials'],
    ['p_sugar', 'Cooking Essentials'],
    ['p_biscuits', 'Snacks'], ['p_tea', 'Beverages'],
  ])('%s → %s', (productId, category) => {
    expect(categorize(productId, seedProducts, 'Household')).toBe(category);
  });

  test('every seed product has a category from the fixed list', () => {
    for (const p of seedProducts) expect(CATEGORY_ORDER).toContain(p.category);
  });

  test('the proposal’s own category is ignored when the catalog knows the product', () => {
    expect(plan([], proposal('p_rice', 5, 'kg', { category: 'Snacks' }))[0].category).toBe('Rice & Grains');
  });
});

test('groupByCategory: fixed store-walk order, add order within a section', () => {
  const items = plan([],
    proposal('p_tea', 250, 'g'), proposal('p_onion', 1, 'kg'), proposal('p_rice', 5, 'kg'),
    proposal('p_tomato', 1, 'kg'), proposal('p_milk', 1, 'L'), proposal('p_salt', 1, 'kg'));
  expect(groupByCategory(items).map((s) => [s.title, s.data.map((i) => i.product)])).toEqual([
    ['Vegetables', ['Onions', 'Tomatoes']],
    ['Dairy', ['Milk']],
    ['Rice & Grains', ['Rice']],
    ['Cooking Essentials', ['Salt']],
    ['Beverages', ['Tea']],
  ]);
});

describe('low-stock proposals', () => {
  const inv = (productId: string, state: InventoryEntry['state'], updatedAt = EARLIER): InventoryEntry =>
    ({ productId, state, updatedAt });
  const propose = (inventory: InventoryEntry[], listItems: ListItem[] = [], dismissed: Record<string, string> = {}) =>
    lowStockProposals(inventory, listItems, seedProducts, initialHouseholdState.preferences, dismissed, NOW);

  test('only almost_finished / out, flagged needsConfirmation, from memory', () => {
    const ps = propose([inv('p_rice', 'almost_finished'), inv('p_milk', 'out'), inv('p_toor_dal', 'running_low'), inv('p_onion', 'available')]);
    expect(ps.map((p) => p.productId)).toEqual(['p_rice', 'p_milk']);
    expect(ps.every((p) => p.needsConfirmation && p.source === 'household_memory')).toBe(true);
  });

  test('remembered amount when there is one; never an invented one', () => {
    const [rice, milk] = propose([inv('p_rice', 'almost_finished'), inv('p_milk', 'out')]);
    expect(rice).toMatchObject({ qty: 5, unit: 'kg', brand: 'Aashirvaad', confidence: 'high' });
    expect(rice.rationale).toBe('Pantry says rice is almost finished. You usually get 5 kg Aashirvaad.');
    expect(milk).toMatchObject({ qty: null, unit: null, brand: null, confidence: 'low' });
    expect(milk.rationale).toBe('Pantry says milk is finished.');
  });

  test('not proposed when already pending on the list', () => {
    const items = plan([], proposal('p_rice', 5, 'kg'));
    expect(propose([inv('p_rice', 'out')], items)).toEqual([]);
    const bought = items.map((i) => ({ ...i, status: 'purchased' as const }));
    expect(propose([inv('p_rice', 'out')], bought)).toHaveLength(1);
  });

  test('"Not now" hides it until the pantry row changes', () => {
    expect(propose([inv('p_rice', 'out')], [], { p_rice: EARLIER })).toEqual([]);
    expect(propose([inv('p_rice', 'out', NOW.toISOString())], [], { p_rice: EARLIER })).toHaveLength(1);
  });
});

describe('reducer: approval flow and item states', () => {
  async function withTomatoes() {
    return (await say(initialHouseholdState, 'get 1 kg tomatoes')).state;
  }

  test('draft → approved; approving an empty list does nothing', async () => {
    expect(reducer(initialHouseholdState, { type: 'APPROVE_LIST' }).list.status).toBe('draft');
    const s = reducer(await withTomatoes(), { type: 'APPROVE_LIST' });
    expect(s.list.status).toBe('approved');
  });

  test('adding items to an approved list reopens it as draft and says so', async () => {
    const approved = reducer(await withTomatoes(), { type: 'APPROVE_LIST' });
    const { r, state } = await say(approved, 'get 2 kg onions');
    expect(r.reply).toMatch(/back to draft/);
    expect(state.list.status).toBe('draft');
  });

  test('a turn that adds nothing leaves an approved list approved', async () => {
    const approved = reducer(await withTomatoes(), { type: 'APPROVE_LIST' });
    const { r, state } = await say(approved, 'show list');
    expect(r.reply).not.toMatch(/back to draft/);
    expect(state.list.status).toBe('approved');
  });

  test('marking purchased on an approved list keeps it approved', async () => {
    const approved = reducer(await withTomatoes(), { type: 'APPROVE_LIST' });
    const viaChat = (await say(approved, 'mark tomatoes purchased')).state;
    expect(viaChat.list.status).toBe('approved');
    expect(viaChat.listItems[0].status).toBe('purchased');
    const viaTick = reducer(approved, { type: 'MARK_PURCHASED_BY_ID', itemId: approved.listItems[0].id });
    expect(viaTick.list.status).toBe('approved');
  });

  test('remove is soft: kept with status removed, hidden from the view and the chat context', async () => {
    const s0 = await withTomatoes();
    const s1 = reducer(s0, { type: 'REMOVE_ITEM', itemId: s0.listItems[0].id });
    expect(s1.listItems).toHaveLength(1);
    expect(s1.listItems[0].status).toBe('removed');
    expect(visibleItems(s1.listItems)).toEqual([]);
    expect(buildChatContext(s1).draftList).toEqual([]);
    // Purchased rows can't be removed.
    const bought = reducer(s0, { type: 'MARK_PURCHASED_BY_ID', itemId: s0.listItems[0].id });
    expect(reducer(bought, { type: 'REMOVE_ITEM', itemId: s0.listItems[0].id }).listItems[0].status).toBe('purchased');
  });

  test('"get 1 kg tomatoes" twice in chat → one 2 kg row', async () => {
    const { state } = await say(await withTomatoes(), 'get 1 kg tomatoes');
    expect(rows(state.listItems)).toEqual([['Tomatoes', 2, 'kg']]);
  });
});

describe('reducer: chat flows that refine a provisional item', () => {
  test('tomatoes "don’t know how much" then "Yes 1 kg" → one 1 kg row, not 2 kg', async () => {
    let { r, state } = await say(initialHouseholdState, "tomatoes I don't know how much");
    expect(r.clarifications[0].itemId).toBe(r.proposedItems[0].id);
    ({ state } = await say(state, 'Yes 1 kg', r.clarifications[0].id));
    expect(rows(state.listItems)).toEqual([['Tomatoes', 1, 'kg']]);
    expect(state.listItems[0]).toMatchObject({ source: 'user', confidence: 'high' });
  });

  test('tomatoes "don’t know how much" then "2 kg" → one 2 kg row', async () => {
    let { r, state } = await say(initialHouseholdState, "tomatoes I don't know how much");
    ({ state } = await say(state, '2 kg', r.clarifications[0].id));
    expect(rows(state.listItems)).toEqual([['Tomatoes', 2, 'kg']]);
  });

  test('coriander → seeds → 100 g leaves exactly one 100 g row under Spices', async () => {
    let { r, state } = await say(initialHouseholdState, 'get coriander');
    ({ r, state } = await say(state, 'Coriander seeds', r.clarifications[0].id));
    ({ state } = await say(state, '100 g', r.clarifications[0].id));
    expect(rows(state.listItems)).toEqual([['Coriander seeds', 100, 'g']]);
    expect(groupByCategory(visibleItems(state.listItems))[0].title).toBe('Spices');
  });
});

describe('reducer: pantry suggestions', () => {
  const riceLow = (s: HouseholdState): HouseholdState =>
    reducer(s, { type: 'SET_INVENTORY', update: { productId: 'p_rice', state: 'almost_finished' } });
  const suggestionsOf = (s: HouseholdState) =>
    lowStockProposals(s.inventory, s.listItems, s.products, s.preferences, s.dismissedRestocks);

  test('Add puts it on the list, confirms the remembered amount, and the suggestion goes away', () => {
    const s0 = riceLow(initialHouseholdState);
    const [rice] = suggestionsOf(s0);
    const before = s0.preferences.find((p) => p.productId === 'p_rice')!;
    const s1 = reducer(s0, { type: 'ACCEPT_RESTOCK', proposal: rice });
    expect(rows(s1.listItems)).toEqual([['Rice', 5, 'kg']]);
    expect(s1.listItems[0]).toMatchObject({ brand: 'Aashirvaad', category: 'Rice & Grains', source: 'household_memory' });
    expect(s1.preferences.find((p) => p.productId === 'p_rice')!.timesConfirmed).toBe(before.timesConfirmed + 1);
    expect(suggestionsOf(s1)).toEqual([]);
    // A second tap (stale UI) doesn't double it.
    expect(reducer(s1, { type: 'ACCEPT_RESTOCK', proposal: rice })).toBe(s1);
  });

  test('Add on an approved list reopens it', async () => {
    let s = (await say(initialHouseholdState, 'get 1 kg tomatoes')).state;
    s = riceLow(reducer(s, { type: 'APPROVE_LIST' }));
    s = reducer(s, { type: 'ACCEPT_RESTOCK', proposal: suggestionsOf(s)[0] });
    expect(s.list.status).toBe('draft');
  });

  test('Not now hides it; a new pantry statement brings it back', () => {
    const s0 = riceLow(initialHouseholdState);
    const s1 = reducer(s0, { type: 'DISMISS_RESTOCK', productId: 'p_rice' });
    expect(suggestionsOf(s1)).toEqual([]);
    const s2 = { ...s1, inventory: s1.inventory.map((i) => (i.productId === 'p_rice' ? { ...i, updatedAt: '2099-01-01T00:00:00Z' } : i)) };
    expect(suggestionsOf(s2)).toHaveLength(1);
  });

  test('"Not now" to the chat restock chip also dismisses the List suggestion', async () => {
    let { r, state } = await say(initialHouseholdState, 'rice is almost finished');
    expect(suggestionsOf(state)).toHaveLength(1);
    ({ state } = await say(state, 'Not now', r.clarifications[0].id));
    expect(suggestionsOf(state)).toEqual([]);
  });

  test('chat "Yes" after the List already added it doesn’t add it twice', async () => {
    let { r, state } = await say(initialHouseholdState, 'rice is almost finished');
    state = reducer(state, { type: 'ACCEPT_RESTOCK', proposal: suggestionsOf(state)[0] });
    ({ r, state } = await say(state, r.clarifications[0].options[0], r.clarifications[0].id));
    expect(r.reply).toMatch(/already on the list/);
    expect(pendingItems(state.listItems)).toHaveLength(1);
  });
});

test('migration: legacy purchased flag, old categories, and missing list fields', () => {
  const legacy = {
    ...initialHouseholdState,
    products: initialHouseholdState.products.map((p) => (p.id === 'p_rice' ? { ...p, category: 'Grains & Rice' } : p)),
    listItems: [
      { id: 'a', productId: 'p_rice', product: 'Rice', category: 'Grains & Rice', qty: 5, unit: 'kg', brand: null, variant: null, confidence: 'high', source: 'user', rationale: '', purchased: true },
      { id: 'b', productId: 'p_bread', product: 'Bread', category: 'Bakery', qty: 1, unit: 'loaf', brand: null, variant: null, confidence: 'high', source: 'user', rationale: '', purchased: false },
    ],
    list: undefined,
    dismissedRestocks: undefined,
  } as unknown as Parameters<typeof migrateState>[0];
  const s = migrateState(legacy);
  expect(s.listItems.map((i) => [i.category, i.status])).toEqual([['Rice & Grains', 'purchased'], ['Dairy', 'pending']]);
  expect(s.listItems[0]).not.toHaveProperty('purchased');
  expect(s.products.find((p) => p.id === 'p_rice')!.category).toBe('Rice & Grains');
  expect(s.list.status).toBe('draft');
  expect(s.dismissedRestocks).toEqual({});
});
