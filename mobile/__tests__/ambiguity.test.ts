import { MockAIService } from '../src/services/MockAIService';
import { buildChatContext, mergePending, reducer } from '../src/state/reducer';
import { initialHouseholdState } from '../src/data/seed';
import type { AIResponse, Clarification, HouseholdState } from '../src/types';

const ai = new MockAIService();

/** Drive one turn the way ChatScreen does: chat → APPLY_AI. */
async function say(state: HouseholdState, text: string, clarificationId?: string) {
  const r = await ai.chat(text, buildChatContext(state, clarificationId));
  return { r, state: reducer(state, { type: 'APPLY_AI', response: r }) };
}

const pendingKinds = (s: HouseholdState) => s.pendingClarifications.map((c) => `${c.kind}:${c.itemRawText}`);

describe('MockAIService ambiguity table', () => {
  test.each([
    ['get coriander', 'ADD_ITEMS', 'product_type'],
    ['get coriander seeds', 'ADD_ITEMS', 'quantity'],
    ["tomatoes I don't know how much", 'ADD_ITEMS', 'quantity'],
    ['get the usual biscuits', 'ADD_ITEMS', 'brand'],
    ['rice is almost finished', 'UPDATE_INVENTORY', 'restock'],
    ['get 2 kg onions', 'ADD_ITEMS', undefined],
  ])('%s → %s / %s', async (text, intent, kind) => {
    const r = await ai.chat(text, buildChatContext(initialHouseholdState));
    expect(r.intent).toBe(intent);
    expect(r.clarifications[0]?.kind).toBe(kind);
  });

  test('"get coriander" asks with 3 options and proposes nothing', async () => {
    const r = await ai.chat('get coriander', buildChatContext(initialHouseholdState));
    expect(r.proposedItems).toEqual([]);
    expect(r.clarifications).toHaveLength(1);
    expect(r.clarifications[0].options).toEqual(['Coriander leaves', 'Coriander seeds', 'Coriander powder']);
  });

  test('tomatoes from memory carries source + rationale', async () => {
    const r = await ai.chat("tomatoes I don't know how much", buildChatContext(initialHouseholdState));
    expect(r.proposedItems[0]).toMatchObject({ qty: 1, unit: 'kg', source: 'household_memory', confidence: 'high' });
  });
});

describe('clarification turn state (plan_04)', () => {
  test('coriander → seeds → 100 g → save as usual', async () => {
    let { r, state } = await say(initialHouseholdState, 'get coriander');
    ({ r, state } = await say(state, 'Coriander seeds', r.clarifications[0].id));
    expect(r.intent).toBe('CLARIFY_RESPONSE');
    expect(r.clarifications[0].kind).toBe('quantity');
    ({ r, state } = await say(state, '100 g', r.clarifications[0].id));
    expect(state.listItems.map((i) => i.product)).toEqual(['Coriander seeds']);
    expect(r.clarifications[0].kind).toBe('save_pref');
    ({ r, state } = await say(state, 'Yes, save', r.clarifications[0].id));
    expect(state.pendingClarifications).toEqual([]);
    expect(state.preferences.find((p) => p.productId === 'p_coriander_seeds')).toMatchObject({ typicalQty: 100, typicalUnit: 'g' });
  });

  test('an unrelated request keeps the old question pending, and its chip still works later', async () => {
    let { r, state } = await say(initialHouseholdState, 'get coriander');
    const corianderQ = r.clarifications[0];

    ({ r, state } = await say(state, 'get 2 kg onions'));
    expect(r.proposedItems[0].product).toBe('Onions');
    expect(state.pendingClarifications.map((c) => c.id)).toContain(corianderQ.id);

    ({ r, state } = await say(state, 'Coriander leaves', corianderQ.id));
    expect(r.resolvedClarificationId).toBe(corianderQ.id);
    expect(state.pendingClarifications.map((c) => c.id)).not.toContain(corianderQ.id);
  });

  test('typing a short answer ("seeds") resolves the matching pending question', async () => {
    let { state } = await say(initialHouseholdState, 'get coriander');
    const { r } = await say(state, 'seeds');
    expect(r.intent).toBe('CLARIFY_RESPONSE');
    expect(r.clarifications[0]).toMatchObject({ kind: 'quantity', productId: 'p_coriander_seeds' });
  });

  test('a new request is not swallowed as a free-text brand answer', async () => {
    let { state } = await say(initialHouseholdState, 'get the usual biscuits');
    const { r, state: next } = await say(state, 'get 2 kg onions');
    expect(r.proposedItems[0]).toMatchObject({ product: 'Onions', brand: null });
    expect(pendingKinds(next)).toEqual(['brand:get the usual biscuits']);
  });

  test('a free-text brand still answers the newest brand question', async () => {
    let { state } = await say(initialHouseholdState, 'get the usual biscuits');
    const { r } = await say(state, 'Sunfeast');
    expect(r.proposedItems[0]).toMatchObject({ product: 'Biscuits', brand: 'Sunfeast' });
  });

  test('a typed custom quantity answers the newest quantity question', async () => {
    let { state } = await say(initialHouseholdState, 'get coriander seeds');
    const { r } = await say(state, '250 g');
    expect(r.proposedItems[0]).toMatchObject({ product: 'Coriander seeds', qty: 250, unit: 'g', source: 'user' });
  });
});

describe('mergePending', () => {
  const clar = (id: string, kind: Clarification['kind'], raw: string): Clarification =>
    ({ id, kind, itemRawText: raw, question: '?', options: [] });
  const resp = (patch: Partial<AIResponse>): AIResponse => ({
    reply: '', intent: 'ADD_ITEMS', proposedItems: [], clarifications: [], inventoryUpdates: [], purchasesMarked: [], ...patch,
  });

  test('drops the resolved one and appends new ones', () => {
    const prior = [clar('a', 'product_type', 'coriander'), clar('b', 'brand', 'biscuits')];
    const out = mergePending(prior, resp({ resolvedClarificationId: 'a', clarifications: [clar('c', 'quantity', 'seeds')] }));
    expect(out.map((c) => c.id)).toEqual(['b', 'c']);
  });

  test('unrelated turn with no questions keeps everything', () => {
    const prior = [clar('a', 'product_type', 'coriander')];
    expect(mergePending(prior, resp({}))).toEqual(prior);
  });

  test('a new question about the same item supersedes the older one', () => {
    const prior = [clar('a', 'product_type', 'Coriander')];
    const out = mergePending(prior, resp({ clarifications: [clar('b', 'product_type', 'coriander')] }));
    expect(out.map((c) => c.id)).toEqual(['b']);
  });

  test('re-asking the same clarification does not duplicate it', () => {
    const prior = [clar('a', 'quantity', 'seeds')];
    const out = mergePending(prior, resp({ resolvedClarificationId: 'a', clarifications: [prior[0]] }));
    expect(out.map((c) => c.id)).toEqual(['a']);
  });
});
