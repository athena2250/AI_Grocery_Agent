import {
  SNOOZE_DAYS,
  classify,
  ewStats,
  homeSuggestions,
  predict,
  predictProduct,
} from '../src/state/prediction';
import { reducer } from '../src/state/reducer';
import { migrateState } from '../src/state/migrate';
import { initialHouseholdState } from '../src/data/seed';
import type { HouseholdState, InventoryEntry, Purchase } from '../src/types';

const NOW = new Date('2026-09-27T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** Purchase times for a series of gaps, ending `sinceLast` days before NOW. */
function series(gaps: number[], sinceLast: number): string[] {
  const out = [daysAgo(sinceLast)];
  let at = sinceLast;
  for (const g of [...gaps].reverse()) out.unshift(daysAgo((at += g)));
  return out;
}

const pantry = (state: InventoryEntry['state'], updatedDaysAgo = 0): InventoryEntry =>
  ({ productId: 'p_curd', state, updatedAt: daysAgo(updatedDaysAgo) });

const statusOf = (gaps: number[], sinceLast: number, row?: InventoryEntry) =>
  predictProduct('p_curd', series(gaps, sinceLast), row, NOW)?.status;

describe('EW stats', () => {
  test('a regular series has its interval as mean and no spread', () => {
    expect(ewStats([7, 7, 7])).toEqual({ mean: 7, std: 0 });
  });

  test('an irregular series (α = 0.4)', () => {
    const { mean, std } = ewStats([5, 9, 6, 10]);
    expect(mean).toBeCloseTo(7.816, 3);
    expect(std).toBeCloseTo(2.148, 3);
  });

  test('classification thresholds: mean − 0.5·std and mean − 1.5·std', () => {
    expect(classify(9, 10, 2)).toBe('BUY_NOW');
    expect(classify(8.9, 10, 2)).toBe('LIKELY_SOON');
    expect(classify(7, 10, 2)).toBe('LIKELY_SOON');
    expect(classify(6.9, 10, 2)).toBe('NOT_NEEDED');
  });
});

describe('synthetic purchase series', () => {
  test('regular weekly: due on day 7, not before', () => {
    expect(statusOf([7, 7, 7], 7)).toBe('BUY_NOW');
    expect(statusOf([7, 7, 7], 10)).toBe('BUY_NOW');
    expect(statusOf([7, 7, 7], 6)).toBe('NOT_NEEDED');
  });

  test('irregular: the spread opens a LIKELY_SOON window', () => {
    // mean ≈ 7.82, std ≈ 2.15 → BUY_NOW ≥ 6.74, LIKELY_SOON ≥ 4.59
    expect(statusOf([5, 9, 6, 10], 7)).toBe('BUY_NOW');
    expect(statusOf([5, 9, 6, 10], 5)).toBe('LIKELY_SOON');
    expect(statusOf([5, 9, 6, 10], 4)).toBe('NOT_NEEDED');
  });

  test('one-off and two-off purchases get no prediction', () => {
    expect(predictProduct('p_curd', [daysAgo(40)], undefined, NOW)).toBeNull();
    expect(predictProduct('p_curd', series([7], 20), undefined, NOW)).toBeNull();
  });

  test('purchases less than a day apart are one trip', () => {
    const sameDay = [daysAgo(14), daysAgo(7), new Date(NOW.getTime() - 7 * 86_400_000 + 3_600_000).toISOString()];
    expect(predictProduct('p_curd', sameDay, undefined, NOW)).toBeNull();
    const p = predictProduct('p_curd', [...sameDay, daysAgo(21)], undefined, NOW)!;
    expect(p.purchaseCount).toBe(3);
    expect(p.meanIntervalDays).toBeCloseTo(7, 1);
  });

  test('input order does not matter', () => {
    const times = series([7, 7], 3);
    expect(predictProduct('p_curd', [...times].reverse(), undefined, NOW)).toEqual(predictProduct('p_curd', times, undefined, NOW));
  });
});

describe('inventory overrides', () => {
  test.each(['almost_finished', 'out'] as const)('%s beats a NOT_NEEDED verdict', (state) => {
    expect(statusOf([7, 7, 7], 2)).toBe('NOT_NEEDED');
    const p = predictProduct('p_curd', series([7, 7, 7], 2), pantry(state), NOW)!;
    expect(p.status).toBe('BUY_NOW');
    expect(p.reason).toBe('pantry_low');
  });

  test('running_low alone does not override', () => {
    expect(statusOf([7, 7, 7], 2, pantry('running_low'))).toBe('NOT_NEEDED');
  });

  test('pantry said "available" within the cooldown → BUY_NOW demoted to LIKELY_SOON', () => {
    const p = predictProduct('p_curd', series([7, 7, 7], 8), pantry('available', 1), NOW)!;
    expect(p.status).toBe('LIKELY_SOON');
    expect(p.reason).toBe('pantry_cooldown');
  });

  test('an old "available" is past the cooldown (half an interval) and does not suppress', () => {
    expect(statusOf([7, 7, 7], 8, pantry('available', 4))).toBe('BUY_NOW');
  });

  test('cooldown is capped at 7 days even for long intervals', () => {
    expect(statusOf([30, 30, 30], 31, pantry('available', 6))).toBe('LIKELY_SOON');
    expect(statusOf([30, 30, 30], 31, pantry('available', 8))).toBe('BUY_NOW');
  });
});

describe('predict over a history', () => {
  const buy = (productId: string, days: number): Purchase =>
    ({ id: `${productId}_${days}`, productId, product: productId, qty: 1, unit: 'kg', brand: null, purchasedAt: daysAgo(days) });

  test('groups by product and skips thin histories', () => {
    const history = [buy('p_rice', 1), buy('p_onion', 10), buy('p_onion', 20), buy('p_onion', 30), buy('p_rice', 40)];
    expect(predict(history, [], NOW).map((p) => [p.productId, p.status])).toEqual([['p_onion', 'BUY_NOW']]);
  });
});

describe('suggestions (never auto-added)', () => {
  const seeded = (): HouseholdState => ({
    ...initialHouseholdState,
    history: [
      ...[8, 15, 22, 29].map((d, i): Purchase => ({
        id: `c${i}`, productId: 'p_curd', product: 'Curd', qty: 400, unit: 'g', brand: 'Amul', purchasedAt: daysAgo(d),
      })),
      ...[11, 21, 32].map((d, i): Purchase => ({
        id: `o${i}`, productId: 'p_onion', product: 'Onions', qty: 1, unit: 'kg', brand: null, purchasedAt: daysAgo(d),
      })),
    ],
  });

  test('BUY_NOW items become confirm-first proposals, usual amount first, else last time', () => {
    const { predicted } = homeSuggestions(seeded(), NOW);
    const [a, b] = predicted;
    expect(predicted.map((p) => p.productId).sort()).toEqual(['p_curd', 'p_onion']);
    const curd = [a, b].find((p) => p.productId === 'p_curd')!;
    const onion = [a, b].find((p) => p.productId === 'p_onion')!;
    expect(curd).toMatchObject({
      qty: 400, unit: 'g', brand: 'Amul', source: 'purchase_history', needsConfirmation: true,
    });
    expect(curd.rationale).toBe('You buy curd about every 7 days — last bought 8 days ago. You usually get 400 g Amul.');
    expect(onion).toMatchObject({ qty: 1, unit: 'kg', brand: null, confidence: 'low' });
    expect(onion.rationale).toContain('Last time: 1 kg.');
  });

  test('a pantry restock suggestion wins over the same product predicted', () => {
    const state = { ...seeded(), inventory: [{ productId: 'p_curd', state: 'out' as const, updatedAt: daysAgo(0) }] };
    const { restock, predicted } = homeSuggestions(state, NOW);
    expect(restock.map((p) => p.productId)).toEqual(['p_curd']);
    expect(predicted.map((p) => p.productId)).toEqual(['p_onion']);
  });

  test('accepting adds to the list (and the suggestion goes away); nothing is added on its own', () => {
    let state = seeded();
    expect(state.listItems).toEqual([]);
    const curd = homeSuggestions(state, NOW).predicted.find((p) => p.productId === 'p_curd')!;
    state = reducer(state, { type: 'ACCEPT_RESTOCK', proposal: curd });
    expect(state.listItems.map((li) => [li.product, li.qty, li.unit, li.source])).toEqual([['Curd', 400, 'g', 'purchase_history']]);
    expect(homeSuggestions(state, NOW).predicted.map((p) => p.productId)).toEqual(['p_onion']);
  });

  test('Not now snoozes a prediction for a few days', () => {
    const state = reducer(seeded(), { type: 'DISMISS_PREDICTION', productId: 'p_onion' });
    const dismissedAt = new Date(state.dismissedPredictions.p_onion);
    const at = (days: number) => new Date(dismissedAt.getTime() + days * 86_400_000);
    expect(homeSuggestions(state, at(1)).predicted.map((p) => p.productId)).not.toContain('p_onion');
    expect(homeSuggestions(state, at(SNOOZE_DAYS)).predicted.map((p) => p.productId)).toContain('p_onion');
  });

  test('buying it resets the clock', () => {
    let state = seeded();
    const curd = homeSuggestions(state, NOW).predicted.find((p) => p.productId === 'p_curd')!;
    state = reducer(state, { type: 'ACCEPT_RESTOCK', proposal: curd });
    state = reducer(state, { type: 'MARK_PURCHASED_BY_ID', itemId: state.listItems[0].id });
    const p = predict(state.history, state.inventory, new Date()).find((x) => x.productId === 'p_curd')!;
    expect(p.status).toBe('NOT_NEEDED');
  });

  test('the seed has something to suggest on first launch', () => {
    expect(homeSuggestions(initialHouseholdState).predicted.map((p) => p.productId).sort()).toEqual(['p_curd', 'p_onion']);
  });

  test('older persisted state gets an empty snooze map', () => {
    const { dismissedPredictions, ...old } = initialHouseholdState;
    expect(migrateState(old).dismissedPredictions).toEqual({});
  });
});
