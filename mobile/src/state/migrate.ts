import type { HouseholdState, Preference } from '../types';
import { START_CONFIDENCE } from './memory';

/** Pre-plan_05 preference shape, as persisted by older builds. */
interface LegacyPreference {
  productId: string;
  brand?: string;
  variant?: string;
  qty?: number;
  unit?: string;
  confidence?: number;
  lastConfirmed?: string;
}

function migratePreference(p: Preference | LegacyPreference): Preference {
  if ('lastConfirmedAt' in p) return p;
  return {
    productId: p.productId,
    preferredBrand: p.brand,
    preferredVariant: p.variant,
    typicalQty: p.qty,
    typicalUnit: p.unit,
    confidence: p.confidence ?? START_CONFIDENCE,
    lastConfirmedAt: p.lastConfirmed ?? new Date().toISOString(),
    timesConfirmed: 0,
    timesOverridden: 0,
  };
}

/** Upgrade a persisted state blob to the current shape. */
export function migrateState(raw: Partial<HouseholdState> & { preferences?: (Preference | LegacyPreference)[] }): HouseholdState {
  return {
    ...(raw as HouseholdState),
    preferences: (raw.preferences ?? []).map(migratePreference),
    aliasPreferences: raw.aliasPreferences ?? [],
  };
}
