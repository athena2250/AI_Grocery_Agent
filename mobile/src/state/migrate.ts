import type { Category, HouseholdState, InventoryEntry, ItemStatus, ListItem, Preference, Product } from '../types';
import { initialHouseholdState, seedProducts } from '../data/seed';
import { START_CONFIDENCE } from './memory';
import { categorize } from './planner';

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

/** Pre-plan_06 pantry rows had no timestamp; stamp them now rather than guess when they were true. */
function migrateInventory(e: Omit<InventoryEntry, 'updatedAt'> & { updatedAt?: string }): InventoryEntry {
  return { ...e, updatedAt: e.updatedAt ?? new Date().toISOString() };
}

/** Pre-plan_08 category names → the fixed plan_08 set. Seed products are re-read from the seed instead. */
const LEGACY_CATEGORY: Record<string, Category> = {
  'Grains & Rice': 'Rice & Grains',
  'Pulses & Dal': 'Pulses',
  Oils: 'Cooking Essentials',
  Bakery: 'Dairy',
  Other: 'Household',
};

function migrateProduct(p: Product): Product {
  const seeded = seedProducts.find((s) => s.id === p.id);
  return { ...p, category: seeded?.category ?? LEGACY_CATEGORY[p.category] ?? p.category };
}

/** Pre-plan_08 list rows had `purchased: boolean` and were hard-deleted on remove. */
type LegacyListItem = Omit<ListItem, 'status'> & { status?: ItemStatus; purchased?: boolean };

function migrateListItem(li: LegacyListItem, products: Product[]): ListItem {
  const { purchased, ...rest } = li;
  return {
    ...rest,
    category: categorize(li.productId, products, LEGACY_CATEGORY[li.category] ?? li.category),
    status: li.status ?? (purchased ? 'purchased' : 'pending'),
  };
}

/** Upgrade a persisted state blob to the current shape. */
export function migrateState(
  raw: Partial<HouseholdState> & { preferences?: (Preference | LegacyPreference)[]; listItems?: LegacyListItem[] },
): HouseholdState {
  const products = (raw.products ?? initialHouseholdState.products).map(migrateProduct);
  return {
    ...(raw as HouseholdState),
    products,
    list: raw.list ?? { id: 'list_1', status: 'draft', createdAt: new Date().toISOString() },
    listItems: (raw.listItems ?? []).map((li) => migrateListItem(li, products)),
    dismissedRestocks: raw.dismissedRestocks ?? {},
    preferences: (raw.preferences ?? []).map(migratePreference),
    aliasPreferences: raw.aliasPreferences ?? [],
    inventory: (raw.inventory ?? []).map(migrateInventory),
  };
}
