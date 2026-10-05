import type { Category, Product } from '../types';

/**
 * Items the catalog doesn't know ("get harpic", "buy quinoa 2 pack"). Pure, no AI.
 *
 * The mock AI uses these to ask "Where does Quinoa go?" with a keyword guess as the
 * pre-filled chip; the reducer uses the same helpers to file the product once Mom
 * answers. Nothing is filed until she does — the guess only marks a chip.
 */

const QTY_RE = /(½|half|1\/2|\d+(?:\.\d+)?)\s*(kg|g|l|ml|litre|liter|pack|packs|dozen|pcs|bunch|loaf)\b/g;
const LEAD_RE = /^(?:(?:please|pls|also|and|we|i|need|needs|want|to|get|buy|add|bring|order|pick up|some|a|an|the|of)\s+)+/;
const TAIL_RE = /\s+(?:to the list|to list|please|pls|also|too)$/;
/** Without one of these (or a quantity), an unknown message isn't treated as an item — "hello" is not a product. */
const ADD_RE = /^(?:please\s+|pls\s+|also\s+)?(?:get|buy|add|need|we need|bring|order|pick up)\b/;
const MAX_WORDS = 4;

const norm = (s: string) => s.toLowerCase().trim().replace(/[?.!,]/g, '').replace(/\s+/g, ' ');

/** "please get harpic 2 pcs" → "harpic". Null when it doesn't read as one item. */
export function extractItemName(text: string): string | null {
  const t = norm(text);
  const hasQty = new RegExp(QTY_RE.source).test(t);
  if (!ADD_RE.test(t) && !hasQty) return null;
  let name = t.replace(QTY_RE, ' ').replace(/\s+/g, ' ').trim();
  let prev = '';
  while (prev !== name) {
    prev = name;
    name = name.replace(LEAD_RE, '').replace(TAIL_RE, '').trim();
  }
  if (!name || name.split(' ').length > MAX_WORDS) return null;
  return name;
}

export const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Same name → same id, so the AI's proposal and the reducer's new product line up. */
export const customProductId = (name: string) => `p_custom_${norm(name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

export function newProduct(name: string, category: Category): Product {
  return { id: customProductId(name), name: titleCase(norm(name)), category, defaultUnit: 'pcs' };
}

const words = (...w: string[]) => new RegExp(`\\b(?:${w.join('|')})\\b`);

/** First match wins: non-food first, so "detergent powder" isn't read as a spice. */
const RULES: [Category, RegExp][] = [
  ['Detergents', words('detergent', 'washing powder', 'washing liquid', 'fabric', 'laundry', 'stain remover')],
  ['Cleaning', words('cleaner', 'cleaning', 'phenyl', 'mop', 'broom', 'jhadu', 'scrub\\w*', 'dishwash', 'dish wash', 'bleach', 'disinfectant', 'naphthalene')],
  ['Personal Care', words('shampoo', 'conditioner', 'face wash', 'facewash', 'body wash', 'lotion', 'face cream', 'cold cream', 'moisturi[sz]er',
    'toothpaste', 'deodorant', 'perfume', 'razor', 'shaving', 'lip balm', 'sunscreen', 'hair \\w+', 'comb', 'pads', 'diapers?', 'sanitizer', 'talc', 'powder puff')],
  ['Household', words('bags?', 'foil', 'cling wrap', 'batter(?:y|ies)', 'bulbs?', 'candles?', 'tissues?', 'napkins?', 'kitchen towel',
    'match(?:es|box)', 'agarbatti', 'incense', 'camphor', 'kapoor', 'diya', 'wicks?', 'mosquito', 'coil', 'pooja \\w+')],
  ['Fruits', words('fruits?', 'mangoe?s?', 'grapes', 'papaya', 'guava', 'watermelon', 'pomegranate', 'pineapple', '\\w*berr(?:y|ies)', 'kiwi', 'pears?', 'chikoo', 'sapota', 'custard apple', 'figs?', 'dates')],
  ['Vegetables', words('vegetables?', 'veggies', 'leaves', 'gourd', 'brinjal', 'beans', 'cabbage', 'cauliflower', 'capsicum', 'cucumber', 'peas', 'okra', 'bhindi',
    'radish', 'beetroot', 'pumpkin', 'methi', 'palak', 'drumsticks?', 'mushrooms?', 'corn', 'lettuce')],
  ['Dairy', words('milk', 'cheese', 'fresh cream', 'yog(?:h)?urt', 'lassi', 'buttermilk', 'eggs?')],
  ['Snacks', words('chips', 'chocolates?', 'cookies', 'mixture', 'wafers', 'noodles', 'maggi', 'cake', 'rusk')],
  ['Beverages', words('juice', 'drink', 'soda', 'cola', 'squash', 'horlicks', 'bournvita', 'boost', 'green tea')],
  ['Spices', words('masala', 'pepper', 'cardamom', 'elaichi', 'cloves?', 'cinnamon', 'jeera', 'hing', 'saffron', 'ajwain', 'fenugreek')],
  ['Rice & Grains', words('flour', 'atta', 'maida', 'oats', 'rava', 'millets?', 'ragi', 'jowar', 'bajra', 'vermicelli', 'quinoa', 'semiya')],
  ['Pulses', words('dal', 'daal', 'lentils?', 'chana', 'chickpeas', 'peanuts', 'groundnuts')],
  ['Cooking Essentials', words('oil', 'vinegar', 'sauce', 'ketchup', 'jaggery', 'honey', 'pickle', 'baking \\w+', 'tamarind')],
];

/** A keyword guess for the pre-filled chip, or undefined when no rule claims it. Never applied without Mom's tap. */
export function guessCategory(name: string): Category | undefined {
  const t = norm(name);
  return RULES.find(([, re]) => re.test(t))?.[0];
}
