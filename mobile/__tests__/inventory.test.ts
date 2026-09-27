import { MockAIService } from '../src/services/MockAIService';
import { parseInventoryPhrase } from '../src/services/inventoryPhrases';
import { buildChatContext, reducer } from '../src/state/reducer';
import { restockPurchased, upsertInventory } from '../src/state/inventory';
import { migrateState } from '../src/state/migrate';
import { initialHouseholdState } from '../src/data/seed';
import type { HouseholdState, InventoryEntry } from '../src/types';

const ai = new MockAIService();
const NOW = new Date('2026-09-27T10:00:00Z');
const EARLIER = '2026-09-01T10:00:00Z';

async function say(state: HouseholdState, text: string, clarificationId?: string) {
  const r = await ai.chat(text, buildChatContext(state, clarificationId));
  return { r, state: reducer(state, { type: 'APPLY_AI', response: r }) };
}

const invOf = (s: HouseholdState, productId: string) => s.inventory.find((i) => i.productId === productId);

describe('inventory phrase parser', () => {
  test.each([
    // English
    ['rice is almost finished', { state: 'almost_finished' }],
    ['dal is nearly over', { state: 'almost_finished' }],
    ['only half a packet of poha left', { state: 'almost_finished', approxQty: 0.5, approxUnit: 'pack' }],
    ['just about 200 g of dal left', { state: 'almost_finished', approxQty: 200, approxUnit: 'g' }],
    ['last packet of biscuits', { state: 'almost_finished' }],
    ['rice is running low', { state: 'running_low' }],
    ["we're running out of oil", { state: 'running_low' }],
    ['oil is low, maybe 0.5 L', { state: 'running_low', approxQty: 0.5, approxUnit: 'L' }],
    ["we don't have enough sugar", { state: 'running_low' }],
    ['we still have plenty of rice', { state: 'available' }],
    ['enough atta, about 3 kg', { state: 'available', approxQty: 3, approxUnit: 'kg' }],
    ['no milk left', { state: 'out' }],
    ['dal is over', { state: 'out' }],
    ['curd finished', { state: 'out' }],
    ['we are out of salt', { state: 'out' }],
    ['no 2 kg rice left', { state: 'out' }],
    // Hindi
    ['chawal khatam hone wala hai', { state: 'almost_finished' }],
    ['curd almost khatam', { state: 'almost_finished' }],
    ['cheeni kam hai', { state: 'running_low' }],
    ['doodh khatam', { state: 'out' }],
    ['atta bahut hai', { state: 'available' }],
    // Telugu
    ['biyyam aipovachindi', { state: 'almost_finished' }],
    ['pappu konchem e undi', { state: 'almost_finished' }],
    ['nune takkuva undi', { state: 'running_low' }],
    ['uppu saripodu', { state: 'running_low' }],
    ['palu aipoyindi', { state: 'out' }],
    ['perugu ledu', { state: 'out' }],
    ['biyyam chala undi', { state: 'available' }],
  ])('%s', (text, expected) => {
    expect(parseInventoryPhrase(text)).toEqual(expected);
  });

  test.each(['get rice', 'mark tomatoes purchased', 'show list', 'get 2 kg onions'])('%s is not an inventory statement', (text) => {
    expect(parseInventoryPhrase(text)).toBeNull();
  });
});

describe('inventory state rules', () => {
  const row = (e: Partial<InventoryEntry> = {}): InventoryEntry => ({ productId: 'p_rice', state: 'available', updatedAt: EARLIER, ...e });

  test('an update on a product not previously in inventory creates a new row', () => {
    const s = reducer(initialHouseholdState, { type: 'APPLY_AI', response: {
      reply: '', intent: 'UPDATE_INVENTORY', proposedItems: [], clarifications: [], purchasesMarked: [],
      inventoryUpdates: [{ productId: 'p_poha', state: 'almost_finished', approxQty: 0.5, approxUnit: 'pack' }],
    } });
    expect(s.inventory).toHaveLength(initialHouseholdState.inventory.length + 1);
    expect(invOf(s, 'p_poha')).toMatchObject({ state: 'almost_finished', approxQty: 0.5, approxUnit: 'pack' });
    expect(invOf(s, 'p_poha')!.updatedAt).toBeTruthy();
  });

  test('upsert keeps one row per product, stamps it, and drops an amount the update did not restate', () => {
    const next = upsertInventory([row({ approxQty: 2, approxUnit: 'kg' })], { productId: 'p_rice', state: 'almost_finished' }, NOW);
    expect(next).toEqual([{ productId: 'p_rice', state: 'almost_finished', updatedAt: NOW.toISOString() }]);
  });

  test('"out" never carries an amount', () => {
    const [r] = upsertInventory([], { productId: 'p_rice', state: 'out', approxQty: 1, approxUnit: 'kg' }, NOW);
    expect(r).toEqual({ productId: 'p_rice', state: 'out', updatedAt: NOW.toISOString() });
  });

  test('a purchase flips the row to available with a fresh timestamp, creating it if needed', () => {
    const next = restockPurchased([row({ state: 'out' })], ['p_rice', 'p_onion'], NOW);
    expect(next).toEqual([
      { productId: 'p_rice', state: 'available', updatedAt: NOW.toISOString() },
      { productId: 'p_onion', state: 'available', updatedAt: NOW.toISOString() },
    ]);
  });

  test('migrate stamps pre-plan_06 rows', () => {
    const s = migrateState({ ...initialHouseholdState, inventory: [{ productId: 'p_rice', state: 'out' }] as never });
    expect(s.inventory[0].updatedAt).toEqual(expect.any(String));
  });
});

describe('integration: pantry via chat', () => {
  test('"rice is almost finished" updates the pantry and proposes — the list waits for the chip', async () => {
    let { r, state } = await say(initialHouseholdState, 'rice is almost finished');
    expect(invOf(state, 'p_rice')).toMatchObject({ state: 'almost_finished' });
    expect(invOf(state, 'p_rice')!.approxQty).toBeUndefined();
    expect(state.listItems).toEqual([]);
    expect(r.clarifications[0]).toMatchObject({
      kind: 'restock', options: ['Yes, 5 kg Aashirvaad', 'Other amount', 'Not now'], suggestedOption: 'Yes, 5 kg Aashirvaad',
    });

    ({ r, state } = await say(state, 'Yes, 5 kg Aashirvaad', r.clarifications[0].id));
    expect(state.listItems[0]).toMatchObject({
      product: 'Rice', qty: 5, unit: 'kg', brand: 'Aashirvaad', source: 'household_memory',
      rationale: 'You said rice is almost finished — you usually get 5 kg Aashirvaad.',
    });
    expect(state.pendingClarifications).toEqual([]);
  });

  test('"Not now" adds nothing', async () => {
    let { r, state } = await say(initialHouseholdState, 'no milk left');
    expect(invOf(state, 'p_milk')).toMatchObject({ state: 'out' });
    ({ state } = await say(state, 'Not now', r.clarifications[0].id));
    expect(state.listItems).toEqual([]);
  });

  test('"Other amount" and no memory both fall through to a quantity question', async () => {
    let { r, state } = await say(initialHouseholdState, 'rice is finished');
    ({ r } = await say(state, 'Other amount', r.clarifications[0].id));
    expect(r.clarifications[0]).toMatchObject({ kind: 'quantity', suggestedOption: '5 kg' });

    ({ r, state } = await say(initialHouseholdState, 'poha is almost finished'));
    expect(r.clarifications[0].options).toEqual(['Yes, add', 'Not now']);
    ({ r } = await say(state, 'Yes, add', r.clarifications[0].id));
    expect(r.clarifications[0].kind).toBe('quantity');
  });

  test('running low only updates the pantry', async () => {
    const { r, state } = await say(initialHouseholdState, 'oil is running low, about 200 ml');
    expect(r.clarifications).toEqual([]);
    expect(r.proposedItems).toEqual([]);
    expect(invOf(state, 'p_sunflower_oil')).toMatchObject({ state: 'running_low', approxQty: 200, approxUnit: 'ml' });
  });

  test('no restock offer when it is already on the list', async () => {
    let { state } = await say(initialHouseholdState, 'get 2 kg rice');
    const { r } = await say(state, 'rice is almost finished');
    expect(r.clarifications).toEqual([]);
    expect(r.reply).toMatch(/already on the list/);
  });

  test('Telugu: "biyyam aipovachindi" works end to end', async () => {
    const { r, state } = await say(initialHouseholdState, 'biyyam aipovachindi');
    expect(invOf(state, 'p_rice')!.state).toBe('almost_finished');
    expect(r.clarifications[0].kind).toBe('restock');
  });

  test('"we still got plenty of rice" is a pantry statement, not a purchase', async () => {
    const { r } = await say(initialHouseholdState, 'we still got plenty of rice');
    expect(r.intent).toBe('UPDATE_INVENTORY');
    expect(r.inventoryUpdates).toEqual([{ productId: 'p_rice', state: 'available' }]);
  });

  test('marking a list item purchased flips its pantry row to available', async () => {
    let { state } = await say(initialHouseholdState, 'toor dal is over');
    expect(invOf(state, 'p_toor_dal')!.state).toBe('out');
    ({ state } = await say(state, 'get 1 kg dal'));
    ({ state } = await say(state, 'mark dal purchased'));
    expect(invOf(state, 'p_toor_dal')!.state).toBe('available');
  });

  test('ticking an item off the list flips a pantry row it never had', async () => {
    let { state } = await say(initialHouseholdState, 'get 1 kg onions');
    state = reducer(state, { type: 'MARK_PURCHASED_BY_ID', itemId: state.listItems[0].id });
    expect(invOf(state, 'p_onion')).toMatchObject({ state: 'available' });
  });

  test('"bought X" when X was not on the list still restocks the pantry', async () => {
    let { state } = await say(initialHouseholdState, 'no milk left');
    const { r, state: s2 } = await say(state, 'I bought milk');
    state = s2;
    expect(r.inventoryUpdates).toEqual([{ productId: 'p_milk', state: 'available' }]);
    expect(invOf(state, 'p_milk')!.state).toBe('available');
  });
});
