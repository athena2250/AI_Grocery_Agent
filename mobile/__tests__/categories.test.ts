import { MockAIService } from '../src/services/MockAIService';
import { buildChatContext, reducer } from '../src/state/reducer';
import { migrateState } from '../src/state/migrate';
import { CATEGORY_ORDER, groupByCategory, visibleItems } from '../src/state/planner';
import { customProductId, extractItemName, guessCategory } from '../src/state/catalog';
import { CATALOG_VERSION, initialHouseholdState, seedAliases, seedProducts } from '../src/data/seed';
import type { HouseholdState } from '../src/types';

const ai = new MockAIService();

async function say(state: HouseholdState, text: string, clarificationId?: string) {
  const r = await ai.chat(text, buildChatContext(state, clarificationId));
  return { r, state: reducer(state, { type: 'APPLY_AI', response: r }) };
}

/** Tap the chip of the newest pending question. */
const tap = (state: HouseholdState, label: string) =>
  say(state, label, state.pendingClarifications[state.pendingClarifications.length - 1].id);

const sections = (s: HouseholdState) =>
  groupByCategory(visibleItems(s.listItems)).map((g) => [g.title, g.data.map((i) => i.product)]);

test('catalog: every product is in a known category, every alias points at a product', () => {
  const ids = new Set(seedProducts.map((p) => p.id));
  for (const p of seedProducts) expect(CATEGORY_ORDER).toContain(p.category);
  for (const a of seedAliases) expect(ids).toContain(a.productId);
});

test('surf excel + apple land in Detergents and Fruits on their own', async () => {
  let s = initialHouseholdState;
  let r;
  ({ r, state: s } = await say(s, 'get surf excel'));
  expect(r.clarifications[0].options).toEqual(['Detergent powder', 'Detergent liquid', 'Detergent bar']);
  expect(r.reply).toMatch(/^Surf Excel/);
  ({ state: s } = await tap(s, 'Detergent powder'));
  ({ r, state: s } = await tap(s, '1 kg'));
  expect(r.proposedItems[0]).toMatchObject({ brand: 'Surf Excel', qty: 1, unit: 'kg' });

  ({ state: s } = await say(s, 'apples 1 kg'));

  expect(sections(s)).toEqual([
    ['Fruits', ['Apples']],
    ['Detergents', ['Detergent powder']],
  ]);
});

test('a brand with one product skips the kind question and keeps the brand', async () => {
  const { r, state } = await say(initialHouseholdState, 'get harpic 2 pcs');
  expect(r.clarifications).toEqual([]);
  expect(r.proposedItems[0]).toMatchObject({ product: 'Toilet cleaner', brand: 'Harpic', category: 'Cleaning' });
  expect(visibleItems(state.listItems)[0].category).toBe('Cleaning');
});

test('"surf" alone asks the kind and does not invent the brand', async () => {
  let s = initialHouseholdState;
  ({ state: s } = await say(s, 'get surf'));
  ({ state: s } = await tap(s, 'Detergent liquid'));
  const { r } = await tap(s, '1 L');
  expect(r.proposedItems[0].brand).toBeNull();
});

test('unknown item: asks where it goes with the keyword guess pre-filled, files nothing yet', async () => {
  const { r, state } = await say(initialHouseholdState, 'get kitchen towel');
  const clar = r.clarifications[0];
  expect(clar.kind).toBe('category');
  expect(clar.suggestedOption).toBe('Household');
  expect(clar.options[0]).toBe('Household');
  expect(clar.options[clar.options.length - 1]).toBe('Other');
  expect(state.products.some((p) => p.id === customProductId('kitchen towel'))).toBe(false);
  expect(visibleItems(state.listItems)).toEqual([]);
});

test('unknown item: the answer files it, asks quantity, and next time it is known', async () => {
  let s = initialHouseholdState;
  let r;
  ({ state: s } = await say(s, 'buy quinoa'));
  ({ r, state: s } = await tap(s, 'Rice & Grains'));
  expect(r.clarifications[0].kind).toBe('quantity');
  expect(s.products.find((p) => p.id === customProductId('quinoa'))).toMatchObject({ name: 'Quinoa', category: 'Rice & Grains' });
  ({ state: s } = await tap(s, '2 pcs'));
  expect(sections(s)).toEqual([['Rice & Grains', ['Quinoa']]]);

  // Learned: no "where does it go?" the second time.
  ({ r } = await say(s, 'get quinoa 1 pack'));
  expect(r.clarifications).toEqual([]);
  expect(r.proposedItems[0]).toMatchObject({ productId: customProductId('quinoa'), category: 'Rice & Grains' });
});

test('unknown item with a quantity is added straight after the category answer', async () => {
  let s = initialHouseholdState;
  ({ state: s } = await say(s, 'get dragon fruit 2 pcs'));
  expect(s.pendingClarifications[0].suggestedOption).toBe('Fruits');
  const { r, state } = await tap(s, 'Fruits');
  expect(r.proposedItems[0]).toMatchObject({ product: 'Dragon Fruit', qty: 2, unit: 'pcs' });
  expect(sections(state)).toEqual([['Fruits', ['Dragon Fruit']]]);
});

test('no rule claims it → no pre-filled chip; "Other" is a real answer', async () => {
  let s = initialHouseholdState;
  let r;
  ({ r, state: s } = await say(s, 'get fevicol'));
  expect(r.clarifications[0].suggestedOption).toBeUndefined();
  ({ state: s } = await tap(s, 'Other'));
  ({ state: s } = await tap(s, '1 pcs'));
  expect(sections(s)).toEqual([['Other', ['Fevicol']]]);
});

test('small talk is not an item', async () => {
  const { r } = await say(initialHouseholdState, 'hello there');
  expect(r.clarifications).toEqual([]);
});

test('Mom moves a product: list rows follow, and it survives a reload', async () => {
  let s = initialHouseholdState;
  ({ state: s } = await say(s, 'get bread 1 loaf'));
  expect(sections(s)).toEqual([['Dairy', ['Bread']]]);
  s = reducer(s, { type: 'SET_PRODUCT_CATEGORY', productId: 'p_bread', category: 'Snacks' });
  expect(sections(s)).toEqual([['Snacks', ['Bread']]]);

  const reloaded = migrateState(JSON.parse(JSON.stringify(s)));
  expect(reloaded.products.find((p) => p.id === 'p_bread')!.category).toBe('Snacks');
  const { r } = await say(reloaded, 'get bread 2 loaf');
  expect(r.proposedItems[0].category).toBe('Snacks');
});

test('extractItemName / guessCategory', () => {
  expect(extractItemName('please get harpic 2 pcs')).toBe('harpic');
  expect(extractItemName('we need some dragon fruit to the list')).toBe('dragon fruit');
  expect(extractItemName('hello')).toBeNull();
  expect(extractItemName('get me the thing from the shop near the temple')).toBeNull();
  expect(guessCategory('detergent powder')).toBe('Detergents');
  expect(guessCategory('garam masala')).toBe('Spices');
  expect(guessCategory('fevicol')).toBeUndefined();
});

describe('migrating saved state to catalog v2', () => {
  const old = {
    ...initialHouseholdState,
    catalogVersion: undefined,
    products: [...seedProducts.filter((p) => p.category !== 'Detergents'), { id: 'p_custom_x', name: 'X', category: 'Other', defaultUnit: 'pcs' }],
    aliases: [{ alias: 'x', productId: 'p_custom_x' }],
    listItems: [{
      id: 'li1', productId: 'p_tomato', product: 'Tomatoes', category: 'Vegetables', qty: 1, unit: 'kg', brand: null, variant: null,
      confidence: 'high', source: 'user', rationale: '', status: 'pending',
    }],
    pendingClarifications: [{ id: 'c1', itemRawText: 'x', kind: 'quantity', question: '?', options: [] }],
  } as unknown as HouseholdState;

  test('clears list, chat and open questions once; keeps memory, pantry, history', () => {
    const s = migrateState(JSON.parse(JSON.stringify(old)));
    expect(s.catalogVersion).toBe(CATALOG_VERSION);
    expect(s.listItems).toEqual([]);
    expect(s.pendingClarifications).toEqual([]);
    expect(s.turns).toEqual(initialHouseholdState.turns);
    expect(s.preferences).toHaveLength(initialHouseholdState.preferences.length);
    expect(s.history).toHaveLength(initialHouseholdState.history.length);
    expect(s.inventory).toHaveLength(initialHouseholdState.inventory.length);
  });

  test('new seed products and brand names arrive; learned products stay', () => {
    const s = migrateState(JSON.parse(JSON.stringify(old)));
    expect(s.products.some((p) => p.id === 'p_detergent_powder')).toBe(true);
    expect(s.aliases.some((a) => a.alias === 'surf excel')).toBe(true);
    expect(s.products.find((p) => p.id === 'p_custom_x')!.category).toBe('Other');
    expect(s.aliases).toContainEqual({ alias: 'x', productId: 'p_custom_x' });
  });

  test('already on v2: the list is left alone', () => {
    const s = migrateState(JSON.parse(JSON.stringify({ ...old, catalogVersion: CATALOG_VERSION })));
    expect(s.listItems).toHaveLength(1);
  });
});
