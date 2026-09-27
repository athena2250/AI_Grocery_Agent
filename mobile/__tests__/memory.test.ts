import { MockAIService } from '../src/services/MockAIService';
import { buildChatContext, reducer } from '../src/state/reducer';
import { migrateState } from '../src/state/migrate';
import { visibleItems } from '../src/state/planner';
import { initialHouseholdState } from '../src/data/seed';
import {
  applyPurchase,
  chooseAlias,
  confirmPreference,
  correctAlias,
  effectiveConfidence,
  getPreferences,
  overridePreference,
  saveAsUsual,
} from '../src/state/memory';
import type { AliasPreference, HouseholdState, ListItem, Preference } from '../src/types';

const ai = new MockAIService();
const NOW = new Date('2026-09-27T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const pref = (p: Partial<Preference> = {}): Preference => ({
  productId: 'p_tomato', typicalQty: 1, typicalUnit: 'kg', confidence: 0.5,
  lastConfirmedAt: daysAgo(10), timesConfirmed: 1, timesOverridden: 0, ...p,
});

async function say(state: HouseholdState, text: string, clarificationId?: string) {
  const r = await ai.chat(text, buildChatContext(state, clarificationId));
  return { r, state: reducer(state, { type: 'APPLY_AI', response: r }) };
}

const prefOf = (s: HouseholdState, productId: string) => s.preferences.find((p) => p.productId === productId);
const aliasOf = (s: HouseholdState, group: string) => s.aliasPreferences.find((a) => a.disambiguationGroup === group);

describe('memory rules', () => {
  test('purchase folds qty into the moving average, learns the interval, +0.1', () => {
    const [p] = applyPurchase([pref({ typicalIntervalDays: 10 })], { productId: 'p_tomato', qty: 2, unit: 'kg' }, daysAgo(4), NOW);
    expect(p).toMatchObject({
      typicalQty: 1.3, typicalUnit: 'kg', typicalIntervalDays: 8, confidence: 0.6,
      timesConfirmed: 2, lastConfirmedAt: NOW.toISOString(),
    });
  });

  test('purchase converts units into the remembered one', () => {
    const [p] = applyPurchase([pref()], { productId: 'p_tomato', qty: 500, unit: 'g' }, undefined, NOW);
    expect(p.typicalQty).toBe(0.85);
    expect(p.typicalIntervalDays).toBeUndefined();
  });

  test('purchase leaves qty alone when units are incomparable, and caps confidence at 1', () => {
    const [p] = applyPurchase([pref({ confidence: 0.95 })], { productId: 'p_tomato', qty: 2, unit: 'pack' }, undefined, NOW);
    expect(p).toMatchObject({ typicalQty: 1, typicalUnit: 'kg', confidence: 1 });
  });

  test('a first purchase does not create a preference', () => {
    expect(applyPurchase([], { productId: 'p_onion', qty: 1, unit: 'kg' }, undefined, NOW)).toEqual([]);
  });

  test('override −0.2 with a floor of 0; confirm +0.1', () => {
    expect(overridePreference([pref({ confidence: 0.9 })], 'p_tomato')[0]).toMatchObject({ confidence: 0.7, timesOverridden: 1 });
    expect(overridePreference([pref({ confidence: 0.1 })], 'p_tomato')[0].confidence).toBe(0);
    expect(confirmPreference([pref()], 'p_tomato', NOW)[0]).toMatchObject({ confidence: 0.6, timesConfirmed: 2 });
  });

  test('staleness: >180 days reads as ×0.7 without rewriting the stored score', () => {
    const stale = pref({ confidence: 0.9, lastConfirmedAt: daysAgo(200) });
    expect(effectiveConfidence(stale, NOW)).toBe(0.63);
    expect(effectiveConfidence(pref({ confidence: 0.9, lastConfirmedAt: daysAgo(100) }), NOW)).toBe(0.9);
    expect(getPreferences([stale, pref({ productId: 'p_onion' })], ['p_tomato'], NOW)).toEqual({
      p_tomato: { ...stale, confidence: 0.63 },
    });
  });

  test('save as usual: new at 0.6; same values never lower it; new values reset to 0.6', () => {
    const fields = { productId: 'p_tomato', typicalQty: 1, typicalUnit: 'kg' };
    expect(saveAsUsual([], fields, NOW)[0]).toMatchObject({ confidence: 0.6, timesConfirmed: 1 });
    expect(saveAsUsual([pref({ confidence: 0.9 })], fields, NOW)[0]).toMatchObject({ confidence: 0.9, timesOverridden: 0 });
    expect(saveAsUsual([pref({ confidence: 0.9 })], { ...fields, typicalQty: 2 }, NOW)[0])
      .toMatchObject({ typicalQty: 2, confidence: 0.6, timesOverridden: 1 });
  });

  test('alias choice: starts at 0.5, confirms, and flips once overrides drop it below 0.5', () => {
    let a: AliasPreference[] = chooseAlias([], 'coriander', 'p_coriander_seeds', NOW);
    expect(a[0]).toMatchObject({ productId: 'p_coriander_seeds', confidence: 0.5 });
    a = chooseAlias(a, 'coriander', 'p_coriander_seeds', NOW);
    expect(a[0].confidence).toBe(0.6);
    a = chooseAlias(a, 'coriander', 'p_coriander_leaves', NOW);
    expect(a[0]).toMatchObject({ productId: 'p_coriander_leaves', confidence: 0.5, timesOverridden: 1 });
  });

  test('alias correction sets the default at 0.6', () => {
    const a = chooseAlias([], 'coriander', 'p_coriander_powder', NOW);
    expect(correctAlias(a, 'coriander', 'p_coriander_seeds', NOW)[0])
      .toMatchObject({ productId: 'p_coriander_seeds', confidence: 0.6, timesOverridden: 1 });
  });
});

describe('reducer: memory writes are gated on confirmed actions', () => {
  const tomatoItem: ListItem = {
    id: 'li1', productId: 'p_tomato', product: 'Tomatoes', category: 'Vegetables', qty: 2, unit: 'kg',
    brand: null, variant: null, confidence: 'high', source: 'user', rationale: '', status: 'pending',
  };

  test('marking purchased updates typical qty (moving avg) and confidence', () => {
    const s0 = { ...initialHouseholdState, listItems: [tomatoItem] };
    const before = prefOf(s0, 'p_tomato')!;
    const s1 = reducer(s0, { type: 'MARK_PURCHASED_BY_ID', itemId: 'li1' });
    expect(prefOf(s1, 'p_tomato')).toMatchObject({
      typicalQty: 1.3, confidence: before.confidence + 0.1, timesConfirmed: before.timesConfirmed + 1,
    });
    expect(s1.history[0]).toMatchObject({ productId: 'p_tomato', qty: 2 });
  });

  test('"mark tomatoes purchased" in chat goes through the same rule', async () => {
    const s0 = { ...initialHouseholdState, listItems: [tomatoItem] };
    const { state } = await say(s0, 'mark tomatoes purchased');
    expect(prefOf(state, 'p_tomato')!.typicalQty).toBe(1.3);
  });

  test('picking a different qty than the remembered one decreases confidence', async () => {
    let { r, state } = await say(initialHouseholdState, "tomatoes I don't know how much");
    expect(r.clarifications[0].suggestedOption).toBe('Yes 1 kg');
    ({ state } = await say(state, '2 kg', r.clarifications[0].id));
    expect(prefOf(state, 'p_tomato')).toMatchObject({ confidence: 0.7, timesOverridden: 1 });
  });

  test('picking the remembered qty confirms it', async () => {
    let { r, state } = await say(initialHouseholdState, "tomatoes I don't know how much");
    ({ state } = await say(state, 'Yes 1 kg', r.clarifications[0].id));
    expect(prefOf(state, 'p_tomato')!.confidence).toBe(1);
  });

  test('the AI proposing from memory writes nothing by itself', async () => {
    const { state } = await say(initialHouseholdState, 'rice is almost finished');
    expect(state.preferences).toEqual(initialHouseholdState.preferences);
    expect(state.aliasPreferences).toEqual(initialHouseholdState.aliasPreferences);
  });

  test('"get coriander" marks the remembered meaning and answering updates it', async () => {
    let { r, state } = await say(initialHouseholdState, 'get coriander');
    expect(r.clarifications[0].suggestedOption).toBe('Coriander seeds');
    expect(r.reply).toMatch(/usually get coriander seeds/);
    ({ state } = await say(state, 'Coriander leaves', r.clarifications[0].id));
    expect(aliasOf(state, 'coriander')).toMatchObject({ productId: 'p_coriander_seeds', confidence: 0.5, timesOverridden: 1 });
  });

  test('"no, seeds not powder" swaps the item and records the correction at 0.6', async () => {
    let { r, state } = await say(initialHouseholdState, 'get coriander');
    ({ r, state } = await say(state, 'Coriander powder', r.clarifications[0].id));
    ({ r, state } = await say(state, '50 g', r.clarifications[0].id));
    expect(state.listItems.map((i) => i.product)).toEqual(['Coriander powder']);

    ({ r, state } = await say(state, 'no, seeds not powder'));
    expect(r.corrections).toHaveLength(1);
    expect(visibleItems(state.listItems).map((i) => [i.product, i.qty, i.unit])).toEqual([['Coriander seeds', 50, 'g']]);
    // The corrected row is soft-removed, not deleted (plan_08).
    expect(state.listItems.find((i) => i.product === 'Coriander powder')?.status).toBe('removed');
    expect(aliasOf(state, 'coriander')).toMatchObject({ productId: 'p_coriander_seeds', confidence: 0.6 });
  });

  test('"Save as usual" from Item Detail upserts at 0.6', () => {
    const s = reducer(initialHouseholdState, {
      type: 'SAVE_AS_USUAL', fields: { productId: 'p_onion', typicalQty: 2, typicalUnit: 'kg' },
    });
    expect(prefOf(s, 'p_onion')).toMatchObject({ typicalQty: 2, confidence: 0.6 });
  });
});

describe('integration: "get the usual X" reads household memory', () => {
  test('usual curd → Amul 400 g from memory with its rationale', async () => {
    const { r, state } = await say(initialHouseholdState, 'get the usual curd');
    expect(r.proposedItems[0]).toMatchObject({
      product: 'Curd', brand: 'Amul', qty: 400, unit: 'g',
      source: 'household_memory', confidence: 'high', rationale: 'Your usual: Amul, 400 g.',
    });
    expect(state.listItems[0].source).toBe('household_memory');
  });

  test('usual rice names the variant in the rationale', async () => {
    const { r } = await say(initialHouseholdState, 'get the usual rice');
    expect(r.proposedItems[0].rationale).toBe('Your usual: Aashirvaad (Sona Masoori), 5 kg.');
  });

  test('a stale preference is proposed but flagged for confirmation', async () => {
    const s0: HouseholdState = {
      ...initialHouseholdState,
      preferences: [pref({ productId: 'p_curd', preferredBrand: 'Amul', typicalQty: 400, typicalUnit: 'g', confidence: 0.9, lastConfirmedAt: '2020-01-01T00:00:00Z' })],
    };
    const { r } = await say(s0, 'get the usual curd');
    expect(r.proposedItems[0]).toMatchObject({ confidence: 'medium', needsConfirmation: true });
  });

  test('"X is almost finished" offers the remembered amount as a chip instead of auto-adding', async () => {
    const s0: HouseholdState = {
      ...initialHouseholdState,
      preferences: [pref({ productId: 'p_rice', typicalQty: 5, typicalUnit: 'kg', confidence: 0.6 })],
    };
    const { r } = await say(s0, 'rice is almost finished');
    expect(r.proposedItems).toEqual([]);
    expect(r.inventoryUpdates).toEqual([{ productId: 'p_rice', state: 'almost_finished' }]);
    expect(r.clarifications[0]).toMatchObject({ kind: 'restock', suggestedOption: 'Yes, 5 kg' });
  });

  test('taking the remembered restock amount confirms memory; "Not now" leaves it alone', async () => {
    let { r, state } = await say(initialHouseholdState, 'rice is almost finished');
    const before = prefOf(state, 'p_rice')!.confidence;
    ({ state } = await say(state, 'Not now', r.clarifications[0].id));
    expect(prefOf(state, 'p_rice')!.confidence).toBe(before);

    ({ r, state } = await say(state, 'rice is finished'));
    ({ state } = await say(state, r.clarifications[0].suggestedOption!, r.clarifications[0].id));
    expect(prefOf(state, 'p_rice')!.confidence).toBe(1);
  });
});

describe('migrateState', () => {
  test('upgrades pre-plan_05 preferences and adds alias preferences', () => {
    const legacy = {
      ...initialHouseholdState,
      preferences: [{ productId: 'p_tomato', brand: 'Local', qty: 1, unit: 'kg', confidence: 0.9, lastConfirmed: daysAgo(1) }],
      aliasPreferences: undefined,
    };
    const s = migrateState(legacy as never);
    expect(s.preferences[0]).toEqual({
      productId: 'p_tomato', preferredBrand: 'Local', preferredVariant: undefined, typicalQty: 1, typicalUnit: 'kg',
      confidence: 0.9, lastConfirmedAt: daysAgo(1), timesConfirmed: 0, timesOverridden: 0,
    });
    expect(s.aliasPreferences).toEqual([]);
  });
});
