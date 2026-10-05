import type { Category, HouseholdState, InventoryEntry, ItemStatus, ListItem, Preference, Product, ProductAlias } from '../types';
import { CATALOG_VERSION, initialHouseholdState, seedAliases, seedProducts } from '../data/seed';
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
};

/** Mom's own move wins over the seed; otherwise seed products take the seed's category. */
function migrateProduct(p: Product, overrides: Record<string, Category>): Product {
  const seeded = seedProducts.find((s) => s.id === p.id);
  return { ...p, category: overrides[p.id] ?? seeded?.category ?? LEGACY_CATEGORY[p.category] ?? p.category };
}

const aliasKey = (a: ProductAlias) => `${a.alias}|${a.productId}`;

/**
 * Seed catalog + what this household taught it. Seed rows come from the current
 * seed (so new products and brand names reach phones with saved state); products
 * and aliases learned from "Where does … go?" are kept.
 */
function mergeCatalog(raw: Partial<HouseholdState>, overrides: Record<string, Category>) {
  const seedIds = new Set(seedProducts.map((p) => p.id));
  const learned = (raw.products ?? []).filter((p) => !seedIds.has(p.id));
  const products = [...seedProducts, ...learned].map((p) => migrateProduct(p, overrides));
  const seedKeys = new Set(seedAliases.map(aliasKey));
  const aliases = [...seedAliases, ...(raw.aliases ?? []).filter((a) => !seedKeys.has(aliasKey(a)))];
  return { products, aliases };
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
  const categoryOverrides = raw.categoryOverrides ?? {};
  const { products, aliases } = mergeCatalog(raw, categoryOverrides);
  // Catalog v2 (2026-10-05) started the grocery list over, as asked: list, chat and open questions are
  // cleared once. Memory, pantry and history are kept.
  const fresh = (raw.catalogVersion ?? 1) < 2;
  return {
    ...(raw as HouseholdState),
    products,
    aliases,
    categoryOverrides,
    catalogVersion: CATALOG_VERSION,
    list: !fresh && raw.list ? raw.list : { id: 'list_1', status: 'draft', createdAt: new Date().toISOString() },
    listItems: fresh ? [] : (raw.listItems ?? []).map((li) => migrateListItem(li, products)),
    pendingClarifications: fresh ? [] : raw.pendingClarifications ?? [],
    turns: fresh ? initialHouseholdState.turns : raw.turns ?? initialHouseholdState.turns,
    dismissedRestocks: raw.dismissedRestocks ?? {},
    dismissedPredictions: raw.dismissedPredictions ?? {},
    preferences: (raw.preferences ?? []).map(migratePreference),
    aliasPreferences: raw.aliasPreferences ?? [],
    inventory: (raw.inventory ?? []).map(migrateInventory),
  };
}
