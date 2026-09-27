import type {
  Category,
  Confidence,
  InventoryEntry,
  ListItem,
  Preference,
  Product,
  ProposedItem,
} from '../types';
import { INVENTORY_STATE_LABEL, needsRestock } from './inventory';
import { confidenceLevel, convertQty, getPreferences } from './memory';

/**
 * Grocery planner — list assembly (plan_08). Pure functions over plain data,
 * no I/O, no AI. Mirrored in backend/app/planner/rules.py.
 *
 *   1. Dedupe against the draft: same product + brand + variant and a unit the
 *      conversion table can bridge → one row with the quantities summed.
 *      Anything else (1 pack + 200 g, an unknown qty) stays a separate row.
 *      A proposal reusing a pending item's id refines that item — replaced, not summed.
 *   2. Categorize from the product catalog only — never from the AI.
 *   3. Default rationale when the proposal had none.
 *   4. Pantry `almost_finished` / `out` → proposals flagged `needsConfirmation`;
 *      they reach the list only when Mom taps Add.
 *   5. Group + sort in the fixed store-walk order below.
 */
export const CATEGORY_ORDER: Category[] = [
  'Vegetables',
  'Fruits',
  'Dairy',
  'Rice & Grains',
  'Pulses',
  'Spices',
  'Cooking Essentials',
  'Snacks',
  'Beverages',
  'Household',
  'Personal Care',
];

export const DEFAULT_RATIONALE = 'You added this in chat.';

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Category comes from the catalog. The proposal's own category is only a fallback for a product the catalog lost. */
export function categorize(productId: string, products: Product[], fallback: Category): Category {
  return products.find((p) => p.id === productId)?.category ?? fallback;
}

// Cross-unit sums are expressed in the bigger unit once they reach it: 1 kg + 500 g → 1.5 kg.
const BIG_UNIT: Record<string, [small: string, big: string]> = {
  g: ['g', 'kg'], kg: ['g', 'kg'], ml: ['ml', 'L'], L: ['ml', 'L'],
};

type Amount = { qty: number | null; unit: string | null };

/** Sum two amounts, or null when they can't be added (unknown qty, or units the table can't bridge). */
export function mergeQty(a: Amount, b: Amount): { qty: number; unit: string } | null {
  if (a.qty == null || b.qty == null || !a.unit || !b.unit) return null;
  if (a.unit === b.unit) return { qty: round3(a.qty + b.qty), unit: a.unit };
  const pair = BIG_UNIT[a.unit];
  const bInSmall = pair && convertQty(b.qty, b.unit, pair[0]);
  if (!pair || bInSmall == null) return null;
  const total = convertQty(a.qty, a.unit, pair[0])! + bInSmall;
  const [small, big] = pair;
  const inBig = convertQty(total, small, big)!;
  return inBig >= 1 ? { qty: round3(inBig), unit: big } : { qty: round3(total), unit: small };
}

const sameChoice = (a: ListItem, b: ListItem) =>
  a.productId === b.productId && a.brand === b.brand && a.variant === b.variant;

function toListItem(p: ProposedItem, products: Product[]): ListItem {
  return {
    id: p.id,
    productId: p.productId,
    product: p.product,
    category: categorize(p.productId, products, p.category),
    qty: p.qty,
    unit: p.unit,
    brand: p.brand,
    variant: p.variant,
    confidence: p.confidence,
    source: p.source,
    rationale: p.rationale.trim() || DEFAULT_RATIONALE,
    status: 'pending',
  };
}

/**
 * Fold this turn's proposals into the list. Only `pending` rows are merge
 * targets — purchased and removed rows are history. `makeId` is used only when
 * a proposal's id is already taken by a non-pending row.
 */
export function mergeIntoDraft(
  listItems: ListItem[],
  proposed: ProposedItem[],
  products: Product[],
  makeId: () => string,
): ListItem[] {
  let items = listItems;
  for (const p of proposed) {
    const incoming = toListItem(p, products);

    const refined = items.findIndex((li) => li.id === incoming.id && li.status === 'pending');
    if (refined >= 0) {
      items = items.map((li, i) => (i === refined ? incoming : li));
      continue;
    }

    const target = items.findIndex((li) => li.status === 'pending' && sameChoice(li, incoming));
    const sum = target >= 0 ? mergeQty(items[target], incoming) : null;
    if (sum) {
      const prior = items[target];
      const lower = CONFIDENCE_RANK[incoming.confidence] < CONFIDENCE_RANK[prior.confidence];
      const merged: ListItem = {
        ...prior,
        ...sum,
        confidence: lower ? incoming.confidence : prior.confidence,
        rationale: `${prior.rationale} Then you added ${incoming.qty} ${incoming.unit} more.`,
      };
      items = items.map((li, i) => (i === target ? merged : li));
      continue;
    }

    const clash = items.some((li) => li.id === incoming.id);
    items = [...items, clash ? { ...incoming, id: makeId() } : incoming];
  }
  return items;
}

/** What the List screen shows: everything but soft-removed rows. */
export const visibleItems = (items: ListItem[]) => items.filter((li) => li.status !== 'removed');
export const pendingItems = (items: ListItem[]) => items.filter((li) => li.status === 'pending');

const categoryRank = (c: Category) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
};

/** Sections in the fixed category order; within a section, items keep the order they were added. */
export function groupByCategory(items: ListItem[]): { title: Category; data: ListItem[] }[] {
  const byCat = new Map<Category, ListItem[]>();
  for (const li of items) {
    if (!byCat.has(li.category)) byCat.set(li.category, []);
    byCat.get(li.category)!.push(li);
  }
  return [...byCat.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b))
    .map(([title, data]) => ({ title, data }));
}

/**
 * Pantry says a product is almost finished / out and it isn't on the list yet →
 * propose it, at the remembered amount if there is one (never an invented one).
 * Each proposal carries `needsConfirmation`: the UI asks, it never auto-adds.
 * A "Not now" hides the suggestion until the pantry row changes again.
 */
export function lowStockProposals(
  inventory: InventoryEntry[],
  listItems: ListItem[],
  products: Product[],
  preferences: Preference[],
  dismissedRestocks: Record<string, string>,
  now: Date = new Date(),
): ProposedItem[] {
  const onList = new Set(pendingItems(listItems).map((li) => li.productId));
  const due = inventory.filter(
    (row) => needsRestock(row.state) && !onList.has(row.productId) && dismissedRestocks[row.productId] !== row.updatedAt,
  );
  const prefs = getPreferences(preferences, due.map((row) => row.productId), now);
  const out: ProposedItem[] = [];
  for (const row of due) {
    const product = products.find((p) => p.id === row.productId);
    if (!product) continue;
    const pref = prefs[product.id];
    const usual = pref?.typicalQty != null && pref.typicalUnit ? pref : undefined;
    const usualText = usual && ` You usually get ${usual.typicalQty} ${usual.typicalUnit}${usual.preferredBrand ? ` ${usual.preferredBrand}` : ''}.`;
    out.push({
      id: `restock_${product.id}`,
      productId: product.id,
      product: product.name,
      category: product.category,
      qty: usual?.typicalQty ?? null,
      unit: usual?.typicalUnit ?? null,
      brand: usual?.preferredBrand ?? null,
      variant: usual?.preferredVariant ?? null,
      confidence: usual ? confidenceLevel(usual.confidence) : 'low',
      source: 'household_memory',
      rationale: `Pantry says ${product.name.toLowerCase()} is ${INVENTORY_STATE_LABEL[row.state]}.${usualText ?? ''}`,
      needsConfirmation: true,
    });
  }
  return out;
}
