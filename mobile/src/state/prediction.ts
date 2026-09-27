import type { HouseholdState, InventoryEntry, ProposedItem, Purchase } from '../types';
import { INVENTORY_STATE_LABEL, needsRestock } from './inventory';
import { confidenceLevel, getPreferences } from './memory';
import { lowStockProposals, pendingItems } from './planner';

/**
 * Purchase prediction (plan_10). Statistics, not ML — pure functions over plain
 * data. Mirrored in backend/app/prediction/rules.py; keep the numbers in sync.
 *
 *   - Only products with ≥ 3 purchases (trips < 1 day apart count once) get a
 *     prediction. No extrapolating from one or two data points.
 *   - mean / std = exponentially-weighted mean / stddev of the gaps, α = 0.4.
 *   - BUY_NOW     if daysSince ≥ mean − 0.5·std
 *     LIKELY_SOON if daysSince ≥ mean − 1.5·std
 *     NOT_NEEDED  otherwise.
 *   - Pantry `almost_finished` / `out` forces BUY_NOW.
 *   - Pantry `available` said within the cooldown (half an interval, ≤ 7 days)
 *     demotes BUY_NOW to LIKELY_SOON — the house just said it has enough.
 *
 * Predictions only ever become suggestions Mom confirms — never auto-added.
 */
export type PredictionStatus = 'BUY_NOW' | 'LIKELY_SOON' | 'NOT_NEEDED';
export type PredictionReason = 'interval' | 'pantry_low' | 'pantry_cooldown';

export interface Prediction {
  productId: string;
  status: PredictionStatus;
  reason: PredictionReason;
  meanIntervalDays: number;
  stdIntervalDays: number;
  daysSince: number;
  lastPurchasedAt: string;
  purchaseCount: number;
}

export const MIN_PURCHASES = 3;
export const EW_ALPHA = 0.4;
export const BUY_NOW_STDS = 0.5;
export const LIKELY_SOON_STDS = 1.5;
export const COOLDOWN_FRACTION = 0.5;
export const COOLDOWN_MAX_DAYS = 7;
/** A "Not now" on a suggestion hides it for this long. */
export const SNOOZE_DAYS = 3;

const DAY_MS = 86_400_000;
const daysBetween = (from: string | Date, to: Date) => (to.getTime() - new Date(from).getTime()) / DAY_MS;

/** Exponentially-weighted mean and stddev (the standard incremental EW variance), oldest first. */
export function ewStats(intervals: number[], alpha = EW_ALPHA): { mean: number; std: number } {
  let mean = intervals[0];
  let variance = 0;
  for (const x of intervals.slice(1)) {
    const diff = x - mean;
    const incr = alpha * diff;
    mean += incr;
    variance = (1 - alpha) * (variance + diff * incr);
  }
  return { mean, std: Math.sqrt(variance) };
}

export function classify(daysSince: number, mean: number, std: number): PredictionStatus {
  if (daysSince >= mean - BUY_NOW_STDS * std) return 'BUY_NOW';
  if (daysSince >= mean - LIKELY_SOON_STDS * std) return 'LIKELY_SOON';
  return 'NOT_NEEDED';
}

/** Purchase times oldest first, with purchases less than a day apart folded into one trip. */
function trips(purchasedAt: string[]): string[] {
  const sorted = [...purchasedAt].sort();
  const out: string[] = [];
  for (const at of sorted) {
    if (!out.length || daysBetween(out[out.length - 1], new Date(at)) >= 1) out.push(at);
  }
  return out;
}

/** One product's prediction, or null when there isn't enough history. */
export function predictProduct(
  productId: string,
  purchasedAt: string[],
  pantry: InventoryEntry | undefined,
  now: Date = new Date(),
): Prediction | null {
  const t = trips(purchasedAt);
  if (t.length < MIN_PURCHASES) return null;
  const intervals = t.slice(1).map((at, i) => daysBetween(t[i], new Date(at)));
  const { mean, std } = ewStats(intervals);
  const lastPurchasedAt = t[t.length - 1];
  const daysSince = daysBetween(lastPurchasedAt, now);

  let status = classify(daysSince, mean, std);
  let reason: PredictionReason = 'interval';
  if (pantry && needsRestock(pantry.state)) {
    status = 'BUY_NOW';
    reason = 'pantry_low';
  } else if (
    status === 'BUY_NOW' && pantry?.state === 'available'
    && daysBetween(pantry.updatedAt, now) < Math.min(COOLDOWN_MAX_DAYS, COOLDOWN_FRACTION * mean)
  ) {
    status = 'LIKELY_SOON';
    reason = 'pantry_cooldown';
  }
  return {
    productId, status, reason, meanIntervalDays: mean, stdIntervalDays: std,
    daysSince, lastPurchasedAt, purchaseCount: t.length,
  };
}

/** Predictions for every product with enough history, in product-id order. */
export function predict(history: Purchase[], inventory: InventoryEntry[], now: Date = new Date()): Prediction[] {
  const byProduct = new Map<string, string[]>();
  for (const h of history) {
    if (!byProduct.has(h.productId)) byProduct.set(h.productId, []);
    byProduct.get(h.productId)!.push(h.purchasedAt);
  }
  return [...byProduct.keys()].sort().flatMap((productId) => {
    const p = predictProduct(productId, byProduct.get(productId)!, inventory.find((i) => i.productId === productId), now);
    return p ? [p] : [];
  });
}

const amountText = (qty: number | null | undefined, unit: string | null | undefined, brand: string | null | undefined) =>
  `${qty} ${unit}${brand ? ` ${brand}` : ''}`;

type SuggestionState = Pick<
  HouseholdState,
  'inventory' | 'listItems' | 'products' | 'preferences' | 'history' | 'dismissedRestocks' | 'dismissedPredictions'
>;

/**
 * BUY_NOW predictions → suggestions (needsConfirmation) for products not on the
 * list and not snoozed, most overdue first. The amount is the household's usual
 * if memory has one, else what was bought last time — never an invented one.
 */
export function predictionProposals(
  predictions: Prediction[],
  state: Omit<SuggestionState, 'dismissedRestocks'>,
  now: Date = new Date(),
): ProposedItem[] {
  const onList = new Set(pendingItems(state.listItems).map((li) => li.productId));
  const snoozed = (productId: string) => {
    const at = state.dismissedPredictions[productId];
    return at != null && daysBetween(at, now) < SNOOZE_DAYS;
  };
  const due = predictions
    .filter((p) => p.status === 'BUY_NOW' && !onList.has(p.productId) && !snoozed(p.productId))
    .sort((a, b) => b.daysSince / b.meanIntervalDays - a.daysSince / a.meanIntervalDays);
  const prefs = getPreferences(state.preferences, due.map((p) => p.productId), now);
  const out: ProposedItem[] = [];
  for (const p of due) {
    const product = state.products.find((x) => x.id === p.productId);
    if (!product) continue;
    const pref = prefs[p.productId];
    const usual = pref?.typicalQty != null && pref.typicalUnit ? pref : undefined;
    const last = state.history.find((h) => h.productId === p.productId && h.purchasedAt === p.lastPurchasedAt);
    const lastAmount = !usual && last?.qty != null && last.unit ? last : undefined;
    const name = product.name.toLowerCase();
    let rationale = `You buy ${name} about every ${Math.round(p.meanIntervalDays)} days — last bought ${Math.round(p.daysSince)} days ago.`;
    const pantry = state.inventory.find((i) => i.productId === p.productId);
    if (p.reason === 'pantry_low' && pantry) rationale += ` Pantry says ${name} is ${INVENTORY_STATE_LABEL[pantry.state]}.`;
    if (usual) rationale += ` You usually get ${amountText(usual.typicalQty, usual.typicalUnit, usual.preferredBrand)}.`;
    else if (lastAmount) rationale += ` Last time: ${amountText(lastAmount.qty, lastAmount.unit, lastAmount.brand)}.`;
    out.push({
      id: `predict_${product.id}`,
      productId: product.id,
      product: product.name,
      category: product.category,
      qty: usual?.typicalQty ?? lastAmount?.qty ?? null,
      unit: usual?.typicalUnit ?? lastAmount?.unit ?? null,
      brand: usual?.preferredBrand ?? lastAmount?.brand ?? null,
      variant: usual?.preferredVariant ?? null,
      confidence: usual ? confidenceLevel(usual.confidence) : 'low',
      source: 'purchase_history',
      rationale,
      needsConfirmation: true,
    });
  }
  return out;
}

/**
 * Everything the app would gently suggest right now: pantry restocks (plan_06/08)
 * and interval predictions (plan_10). A product appears once — the pantry
 * suggestion wins, since Mom said it herself.
 */
export function homeSuggestions(
  state: SuggestionState,
  now: Date = new Date(),
): { restock: ProposedItem[]; predicted: ProposedItem[] } {
  const restock = lowStockProposals(state.inventory, state.listItems, state.products, state.preferences, state.dismissedRestocks, now);
  const shown = new Set(restock.map((p) => p.productId));
  const predicted = predictionProposals(predict(state.history, state.inventory, now), state, now)
    .filter((p) => !shown.has(p.productId));
  return { restock, predicted };
}
