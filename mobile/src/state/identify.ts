import type { Category, HouseholdState, Product, ProductAlias } from '../types';
import { customProductId, extractItemName, guessCategory, titleCase } from './catalog';

/**
 * "Add item" step 1: which product did Mom type? Pure catalog lookup, no AI.
 *
 * "surf excel" → Detergents, brand Surf Excel, kind still open (powder/liquid/bar);
 * "apple" → Fruits › Apples, in kg; "harpic" → not in the catalog, with a keyword
 * guess for the section chip. Nothing here is applied without Mom's tap on the
 * details page — a single match only pre-selects, it never saves.
 */
export interface ItemMatch {
  /** The cleaned name: "please get Surf Excel 2 kg" → "surf excel". */
  name: string;
  /** 1 = known product; >1 = ask which kind; 0 = new to the catalog. */
  candidates: Product[];
  /** Brand Mom said instead of the product ("surf excel"). Her words, so it's filled in. */
  brand: string | null;
  /** Disambiguation group of the candidates ("detergent"), for the household's usual kind. */
  group?: string;
  /** The household's usual pick for `group`, pre-marked as a chip. */
  usualProductId?: string;
  /** New items only: keyword guess for the section chip. */
  guess?: Category;
  /** A quantity typed with the name ("apples 2 kg"). */
  qty?: { qty: number; unit: string };
}

const norm = (s: string) => s.toLowerCase().trim().replace(/[?.!,]/g, '').replace(/\s+/g, ' ');
const QTY_RE = /(½|half|1\/2|\d+(?:\.\d+)?)\s*(kg|g|l|ml|litre|liter|pack|packs|dozen|pcs|bunch|loaf)\b/;
const UNIT_OF: Record<string, string> = { l: 'L', litre: 'L', liter: 'L', ml: 'ml', packs: 'pack' };
/** Words that pick one kind out of a group: "surf excel liquid" → Detergent liquid. */
const KIND_WORDS = ['powder', 'liquid', 'bar', 'seeds', 'leaves'];

function parseQty(text: string): ItemMatch['qty'] {
  const m = norm(text).match(QTY_RE);
  if (!m) return undefined;
  const qty = ['½', 'half', '1/2'].includes(m[1]) ? 0.5 : Number(m[1]);
  return { qty, unit: UNIT_OF[m[2]] ?? m[2] };
}

const singular = (s: string) => s.replace(/(?:es|s)$/, '');
const hasWord = (text: string, word: string) => new RegExp(`(?:^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(text);

export function identifyItem(
  text: string,
  state: Pick<HouseholdState, 'products' | 'aliases' | 'aliasPreferences'>,
): ItemMatch | null {
  const name = extractItemName(`get ${text}`) ?? norm(text);
  if (!name) return null;
  const { products, aliases } = state;

  // Exact name or alias first, then the longest alias inside what she typed, then an alias she's still typing.
  const exact = aliases.filter((a) => a.alias === name || singular(a.alias) === singular(name));
  const byName = products.filter((p) => norm(p.name) === name || singular(norm(p.name)) === singular(name));
  const inside = aliases
    .filter((a) => hasWord(name, a.alias))
    .sort((a, b) => b.alias.length - a.alias.length);
  const longest = inside[0]?.alias;
  const typing = name.length >= 3 ? aliases.filter((a) => a.alias.startsWith(name)) : [];

  const hits: ProductAlias[] = exact.length ? exact
    : byName.length ? byName.map((p) => ({ alias: name, productId: p.id }))
      : longest ? inside.filter((a) => a.alias === longest)
        : typing;

  let ids = [...new Set(hits.map((a) => a.productId))];
  const kind = KIND_WORDS.find((w) => hasWord(name, w));
  if (kind && ids.length > 1) {
    const narrowed = ids.filter((id) => products.find((p) => p.id === id)?.name.toLowerCase().includes(kind));
    if (narrowed.length) ids = narrowed;
  }
  const candidates = ids.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => !!p);

  const brands = [...new Set(hits.filter((a) => ids.includes(a.productId)).map((a) => a.brand ?? null))];
  const group = aliases.find((a) => ids.includes(a.productId) && a.disambiguationGroup)?.disambiguationGroup;
  const usual = candidates.length > 1 && group
    ? state.aliasPreferences.find((p) => p.disambiguationGroup === group && ids.includes(p.productId))?.productId
    : undefined;

  return {
    name,
    candidates,
    brand: brands.length === 1 ? brands[0] : null,
    ...(group ? { group } : {}),
    ...(usual ? { usualProductId: usual } : {}),
    ...(candidates.length ? {} : { guess: guessCategory(name) }),
    ...(parseQty(text) ? { qty: parseQty(text) } : {}),
  };
}

/** A product for an item the catalog doesn't know yet, filed where Mom said. */
export function newCatalogProduct(name: string, category: Category, unit: string): Product {
  return { id: customProductId(name), name: titleCase(name), category, defaultUnit: unit };
}

/** Quantity chips per unit — the amounts a store actually sells. */
const AMOUNTS: Record<string, number[]> = {
  kg: [0.5, 1, 2, 5],
  g: [100, 250, 500],
  L: [0.5, 1, 2, 5],
  ml: [200, 500],
  dozen: [0.5, 1, 2],
  pcs: [1, 2, 3, 6],
  pack: [1, 2, 3],
  bunch: [1, 2, 3],
  loaf: [1, 2],
};

/** Units she can switch between for a product: kg ↔ g, L ↔ ml; counted things stay counted. */
export function unitChoices(defaultUnit: string): string[] {
  if (defaultUnit === 'kg' || defaultUnit === 'g') return ['kg', 'g'];
  if (defaultUnit === 'L' || defaultUnit === 'ml') return ['L', 'ml'];
  return [defaultUnit];
}

export const amountChoices = (unit: string): number[] => AMOUNTS[unit] ?? [1, 2, 3];

export const fmtQty = (qty: number, unit: string) => `${qty === 0.5 ? '½' : qty} ${unit}`;
