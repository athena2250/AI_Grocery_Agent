import type { AliasPreference, Confidence, Preference } from '../types';

/**
 * Household memory rules (plan_05). Pure functions over plain data — no I/O,
 * no AI. Mirrored in backend/app/memory/rules.py; keep the numbers in sync.
 *
 *   - First explicit choice starts at 0.5; "save as usual" / a correction at 0.6.
 *   - Confirmation (purchase, picking the remembered option)   → +0.1, cap 1.0.
 *   - Override (picking something other than the remembered one) → −0.2, floor 0.
 *   - Not confirmed for 180 days → read as confidence × 0.7 (never written back).
 *   - Auto-suggest gate: effective confidence ≥ 0.7.
 *
 * Every write here is triggered by a confirmed user action in the reducer.
 * The AI never writes memory.
 */
export const START_CONFIDENCE = 0.5;
export const SAVE_AS_USUAL_CONFIDENCE = 0.6;
export const CORRECTION_CONFIDENCE = 0.6;
export const CONFIRM_STEP = 0.1;
export const OVERRIDE_STEP = 0.2;
export const STALE_AFTER_DAYS = 180;
export const STALE_FACTOR = 0.7;
export const AUTO_SUGGEST_GATE = 0.7;
/** Weight of the newest purchase in the typical-qty / interval moving averages. */
export const MOVING_AVG_WEIGHT = 0.3;

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, round2(n)));

export const confirmed = (c: number) => clamp01(c + CONFIRM_STEP);
export const overridden = (c: number) => clamp01(c - OVERRIDE_STEP);
export const movingAverage = (old: number, next: number) =>
  old * (1 - MOVING_AVG_WEIGHT) + next * MOVING_AVG_WEIGHT;

type Scored = { confidence: number; lastConfirmedAt: string };

export function isStale(p: Scored, now: Date = new Date()): boolean {
  return now.getTime() - new Date(p.lastConfirmedAt).getTime() > STALE_AFTER_DAYS * DAY_MS;
}

export function effectiveConfidence(p: Scored, now: Date = new Date()): number {
  return isStale(p, now) ? round2(p.confidence * STALE_FACTOR) : p.confidence;
}

/** Numeric memory confidence → the high/medium/low shown on a list item. */
export function confidenceLevel(score: number): Confidence {
  if (score >= AUTO_SUGGEST_GATE) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * Read API (plan_05 `get_preferences`): preferences for the given products,
 * keyed by productId, with `confidence` already decayed for staleness.
 */
export function getPreferences(
  prefs: Preference[],
  productIds: string[],
  now: Date = new Date(),
): Record<string, Preference> {
  const wanted = new Set(productIds);
  const out: Record<string, Preference> = {};
  for (const p of prefs) {
    if (wanted.has(p.productId)) out[p.productId] = { ...p, confidence: effectiveConfidence(p, now) };
  }
  return out;
}

export function getAliasPreference(
  aliasPrefs: AliasPreference[],
  group: string,
  now: Date = new Date(),
): AliasPreference | undefined {
  const p = aliasPrefs.find((a) => a.disambiguationGroup === group);
  return p && { ...p, confidence: effectiveConfidence(p, now) };
}

// Mass/volume only; anything else (pack, bunch, …) must match exactly.
const UNIT_BASE: Record<string, [base: string, factor: number]> = {
  g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], L: ['ml', 1000],
};

export function convertQty(qty: number, from: string, to: string): number | null {
  if (from === to) return qty;
  const a = UNIT_BASE[from];
  const b = UNIT_BASE[to];
  if (!a || !b || a[0] !== b[0]) return null;
  return (qty * a[1]) / b[1];
}

function replace<T>(list: T[], idx: number, next: T): T[] {
  const out = [...list];
  if (idx >= 0) out[idx] = next;
  else out.push(next);
  return out;
}

export interface PurchaseFact {
  productId: string;
  qty: number | null;
  unit: string | null;
}

/**
 * A confirmed purchase: fold qty into the typical-qty moving average, learn the
 * repurchase interval from the previous purchase, +0.1 confidence. Only updates
 * an existing preference — a first purchase doesn't create one.
 */
export function applyPurchase(
  prefs: Preference[],
  purchase: PurchaseFact,
  previousPurchaseAt: string | undefined,
  now: Date,
): Preference[] {
  const idx = prefs.findIndex((p) => p.productId === purchase.productId);
  if (idx < 0) return prefs;
  const p = prefs[idx];

  let { typicalQty, typicalUnit } = p;
  if (purchase.qty != null && purchase.unit) {
    const q = typicalQty != null && typicalUnit ? convertQty(purchase.qty, purchase.unit, typicalUnit) : null;
    if (typicalQty == null || !typicalUnit) {
      typicalQty = purchase.qty;
      typicalUnit = purchase.unit;
    } else if (q != null) {
      typicalQty = round2(movingAverage(typicalQty, q));
    }
  }

  let typicalIntervalDays = p.typicalIntervalDays;
  if (previousPurchaseAt) {
    const gap = Math.round((now.getTime() - new Date(previousPurchaseAt).getTime()) / DAY_MS);
    if (gap >= 1) {
      typicalIntervalDays = typicalIntervalDays == null ? gap : Math.round(movingAverage(typicalIntervalDays, gap));
    }
  }

  return replace(prefs, idx, {
    ...p,
    typicalQty,
    typicalUnit,
    typicalIntervalDays,
    confidence: confirmed(p.confidence),
    lastConfirmedAt: now.toISOString(),
    timesConfirmed: p.timesConfirmed + 1,
  });
}

export interface UsualFields {
  productId: string;
  preferredBrand?: string;
  preferredVariant?: string;
  typicalQty?: number;
  typicalUnit?: string;
}

/**
 * Explicit "save as usual". New → 0.6. Re-saving the same values never lowers
 * confidence; saving different values replaces them at 0.6 (counts as an override).
 */
export function saveAsUsual(prefs: Preference[], f: UsualFields, now: Date): Preference[] {
  const idx = prefs.findIndex((p) => p.productId === f.productId);
  const at = now.toISOString();
  if (idx < 0) {
    return [...prefs, { ...f, confidence: SAVE_AS_USUAL_CONFIDENCE, lastConfirmedAt: at, timesConfirmed: 1, timesOverridden: 0 }];
  }
  const p = prefs[idx];
  const same =
    p.preferredBrand === f.preferredBrand &&
    p.preferredVariant === f.preferredVariant &&
    p.typicalQty === f.typicalQty &&
    p.typicalUnit === f.typicalUnit;
  return replace(prefs, idx, {
    ...p,
    ...f,
    confidence: same ? Math.max(p.confidence, SAVE_AS_USUAL_CONFIDENCE) : SAVE_AS_USUAL_CONFIDENCE,
    lastConfirmedAt: at,
    timesConfirmed: p.timesConfirmed + 1,
    timesOverridden: p.timesOverridden + (same ? 0 : 1),
  });
}

/** The user picked the remembered option ("yes, 1 kg"). No-op without a preference. */
export function confirmPreference(prefs: Preference[], productId: string, now: Date): Preference[] {
  const idx = prefs.findIndex((p) => p.productId === productId);
  if (idx < 0) return prefs;
  const p = prefs[idx];
  return replace(prefs, idx, {
    ...p, confidence: confirmed(p.confidence), lastConfirmedAt: now.toISOString(), timesConfirmed: p.timesConfirmed + 1,
  });
}

/** The user picked something other than the remembered option. No-op without a preference. */
export function overridePreference(prefs: Preference[], productId: string): Preference[] {
  const idx = prefs.findIndex((p) => p.productId === productId);
  if (idx < 0) return prefs;
  const p = prefs[idx];
  return replace(prefs, idx, { ...p, confidence: overridden(p.confidence), timesOverridden: p.timesOverridden + 1 });
}

/**
 * The user answered a disambiguation question ("coriander" → seeds).
 * None remembered → start at 0.5. Same as remembered → +0.1. Different → −0.2,
 * and once that drops below 0.5 the default flips to the new choice at 0.5.
 */
export function chooseAlias(
  aliasPrefs: AliasPreference[],
  group: string,
  productId: string,
  now: Date,
): AliasPreference[] {
  const idx = aliasPrefs.findIndex((a) => a.disambiguationGroup === group);
  const at = now.toISOString();
  if (idx < 0) {
    return [...aliasPrefs, {
      disambiguationGroup: group, productId, confidence: START_CONFIDENCE, lastConfirmedAt: at, timesConfirmed: 1, timesOverridden: 0,
    }];
  }
  const a = aliasPrefs[idx];
  if (a.productId === productId) {
    return replace(aliasPrefs, idx, { ...a, confidence: confirmed(a.confidence), lastConfirmedAt: at, timesConfirmed: a.timesConfirmed + 1 });
  }
  const lowered = overridden(a.confidence);
  const flipped = lowered < START_CONFIDENCE;
  return replace(aliasPrefs, idx, {
    ...a,
    productId: flipped ? productId : a.productId,
    confidence: flipped ? START_CONFIDENCE : lowered,
    lastConfirmedAt: flipped ? at : a.lastConfirmedAt,
    timesOverridden: a.timesOverridden + 1,
  });
}

/** An explicit correction ("no, seeds not powder") sets the group default at 0.6. */
export function correctAlias(
  aliasPrefs: AliasPreference[],
  group: string,
  productId: string,
  now: Date,
): AliasPreference[] {
  const idx = aliasPrefs.findIndex((a) => a.disambiguationGroup === group);
  const prior = idx >= 0 ? aliasPrefs[idx] : undefined;
  const same = prior?.productId === productId;
  return replace(aliasPrefs, idx, {
    disambiguationGroup: group,
    productId,
    confidence: same ? Math.max(prior!.confidence, CORRECTION_CONFIDENCE) : CORRECTION_CONFIDENCE,
    lastConfirmedAt: now.toISOString(),
    timesConfirmed: (prior?.timesConfirmed ?? 0) + 1,
    timesOverridden: (prior?.timesOverridden ?? 0) + (prior && !same ? 1 : 0),
  });
}
