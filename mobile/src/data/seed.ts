import type {
  HouseholdState,
  Product,
  ProductAlias,
  Preference,
  AliasPreference,
  InventoryEntry,
  Purchase,
} from '../types';

export const seedProducts: Product[] = [
  // Vegetables
  { id: 'p_tomato', name: 'Tomatoes', category: 'Vegetables', defaultUnit: 'kg' },
  { id: 'p_onion', name: 'Onions', category: 'Vegetables', defaultUnit: 'kg' },
  { id: 'p_potato', name: 'Potatoes', category: 'Vegetables', defaultUnit: 'kg' },
  { id: 'p_carrot', name: 'Carrots', category: 'Vegetables', defaultUnit: 'kg' },
  { id: 'p_ginger', name: 'Ginger', category: 'Vegetables', defaultUnit: 'g' },
  { id: 'p_garlic', name: 'Garlic', category: 'Vegetables', defaultUnit: 'g' },
  { id: 'p_chilli', name: 'Green chilli', category: 'Vegetables', defaultUnit: 'g' },
  { id: 'p_coriander_leaves', name: 'Coriander leaves', category: 'Vegetables', defaultUnit: 'bunch' },
  { id: 'p_curry_leaves', name: 'Curry leaves', category: 'Vegetables', defaultUnit: 'bunch' },
  { id: 'p_spinach', name: 'Spinach', category: 'Vegetables', defaultUnit: 'bunch' },

  // Fruits
  { id: 'p_banana', name: 'Bananas', category: 'Fruits', defaultUnit: 'dozen' },
  { id: 'p_apple', name: 'Apples', category: 'Fruits', defaultUnit: 'kg' },
  { id: 'p_orange', name: 'Oranges', category: 'Fruits', defaultUnit: 'kg' },
  { id: 'p_lemon', name: 'Lemons', category: 'Fruits', defaultUnit: 'pcs' },

  // Rice & Grains
  { id: 'p_rice', name: 'Rice', category: 'Rice & Grains', defaultUnit: 'kg' },
  { id: 'p_wheat_atta', name: 'Wheat atta', category: 'Rice & Grains', defaultUnit: 'kg' },
  { id: 'p_poha', name: 'Poha', category: 'Rice & Grains', defaultUnit: 'g' },
  { id: 'p_sooji', name: 'Sooji', category: 'Rice & Grains', defaultUnit: 'g' },

  // Pulses
  { id: 'p_toor_dal', name: 'Toor dal', category: 'Pulses', defaultUnit: 'kg' },
  { id: 'p_moong_dal', name: 'Moong dal', category: 'Pulses', defaultUnit: 'kg' },
  { id: 'p_chana_dal', name: 'Chana dal', category: 'Pulses', defaultUnit: 'kg' },
  { id: 'p_rajma', name: 'Rajma', category: 'Pulses', defaultUnit: 'g' },

  // Spices
  { id: 'p_coriander_seeds', name: 'Coriander seeds', category: 'Spices', defaultUnit: 'g' },
  { id: 'p_coriander_powder', name: 'Coriander powder', category: 'Spices', defaultUnit: 'g' },
  { id: 'p_turmeric', name: 'Turmeric powder', category: 'Spices', defaultUnit: 'g' },
  { id: 'p_chilli_powder', name: 'Red chilli powder', category: 'Spices', defaultUnit: 'g' },
  { id: 'p_cumin', name: 'Cumin seeds', category: 'Spices', defaultUnit: 'g' },
  { id: 'p_mustard_seeds', name: 'Mustard seeds', category: 'Spices', defaultUnit: 'g' },
  { id: 'p_garam_masala', name: 'Garam masala', category: 'Spices', defaultUnit: 'g' },

  // Cooking Essentials
  { id: 'p_salt', name: 'Salt', category: 'Cooking Essentials', defaultUnit: 'kg' },
  { id: 'p_sugar', name: 'Sugar', category: 'Cooking Essentials', defaultUnit: 'kg' },
  { id: 'p_sunflower_oil', name: 'Sunflower oil', category: 'Cooking Essentials', defaultUnit: 'L' },
  { id: 'p_ghee', name: 'Ghee', category: 'Cooking Essentials', defaultUnit: 'g' },

  // Dairy (bread sits with it, as in most Indian stores)
  { id: 'p_milk', name: 'Milk', category: 'Dairy', defaultUnit: 'L' },
  { id: 'p_curd', name: 'Curd', category: 'Dairy', defaultUnit: 'g' },
  { id: 'p_paneer', name: 'Paneer', category: 'Dairy', defaultUnit: 'g' },
  { id: 'p_butter', name: 'Butter', category: 'Dairy', defaultUnit: 'g' },
  { id: 'p_bread', name: 'Bread', category: 'Dairy', defaultUnit: 'loaf' },

  // Snacks
  { id: 'p_biscuits', name: 'Biscuits', category: 'Snacks', defaultUnit: 'pack' },
  { id: 'p_namkeen', name: 'Namkeen', category: 'Snacks', defaultUnit: 'g' },

  // Beverages
  { id: 'p_tea', name: 'Tea', category: 'Beverages', defaultUnit: 'g' },
  { id: 'p_coffee', name: 'Coffee', category: 'Beverages', defaultUnit: 'g' },
];

export const seedAliases: ProductAlias[] = [
  // Coriander ambiguity
  { alias: 'coriander', productId: 'p_coriander_leaves', disambiguationGroup: 'coriander' },
  { alias: 'coriander', productId: 'p_coriander_seeds', disambiguationGroup: 'coriander' },
  { alias: 'coriander', productId: 'p_coriander_powder', disambiguationGroup: 'coriander' },
  { alias: 'dhania', productId: 'p_coriander_leaves', disambiguationGroup: 'coriander' },
  { alias: 'dhania', productId: 'p_coriander_seeds', disambiguationGroup: 'coriander' },
  { alias: 'coriander leaves', productId: 'p_coriander_leaves' },
  { alias: 'coriander seeds', productId: 'p_coriander_seeds' },
  { alias: 'coriander powder', productId: 'p_coriander_powder' },

  { alias: 'tomato', productId: 'p_tomato' },
  { alias: 'tomatoes', productId: 'p_tomato' },
  { alias: 'onion', productId: 'p_onion' },
  { alias: 'onions', productId: 'p_onion' },
  { alias: 'potato', productId: 'p_potato' },
  { alias: 'potatoes', productId: 'p_potato' },
  { alias: 'aloo', productId: 'p_potato' },
  { alias: 'ginger', productId: 'p_ginger' },
  { alias: 'garlic', productId: 'p_garlic' },
  { alias: 'chilli', productId: 'p_chilli' },
  { alias: 'green chilli', productId: 'p_chilli' },

  { alias: 'banana', productId: 'p_banana' },
  { alias: 'bananas', productId: 'p_banana' },
  { alias: 'apple', productId: 'p_apple' },
  { alias: 'apples', productId: 'p_apple' },
  { alias: 'lemon', productId: 'p_lemon' },
  { alias: 'lemons', productId: 'p_lemon' },

  { alias: 'rice', productId: 'p_rice' },
  { alias: 'chawal', productId: 'p_rice' },
  { alias: 'atta', productId: 'p_wheat_atta' },
  { alias: 'wheat', productId: 'p_wheat_atta' },
  { alias: 'poha', productId: 'p_poha' },
  { alias: 'sooji', productId: 'p_sooji' },

  { alias: 'toor dal', productId: 'p_toor_dal' },
  { alias: 'dal', productId: 'p_toor_dal' },
  { alias: 'moong dal', productId: 'p_moong_dal' },
  { alias: 'chana dal', productId: 'p_chana_dal' },
  { alias: 'rajma', productId: 'p_rajma' },

  { alias: 'turmeric', productId: 'p_turmeric' },
  { alias: 'haldi', productId: 'p_turmeric' },
  { alias: 'red chilli powder', productId: 'p_chilli_powder' },
  { alias: 'chilli powder', productId: 'p_chilli_powder' },
  { alias: 'cumin', productId: 'p_cumin' },
  { alias: 'jeera', productId: 'p_cumin' },
  { alias: 'mustard', productId: 'p_mustard_seeds' },
  { alias: 'rai', productId: 'p_mustard_seeds' },
  { alias: 'garam masala', productId: 'p_garam_masala' },
  { alias: 'salt', productId: 'p_salt' },
  { alias: 'namak', productId: 'p_salt' },
  { alias: 'sugar', productId: 'p_sugar' },
  { alias: 'cheeni', productId: 'p_sugar' },

  { alias: 'oil', productId: 'p_sunflower_oil' },
  { alias: 'sunflower oil', productId: 'p_sunflower_oil' },
  { alias: 'ghee', productId: 'p_ghee' },

  { alias: 'milk', productId: 'p_milk' },
  { alias: 'doodh', productId: 'p_milk' },
  { alias: 'curd', productId: 'p_curd' },
  { alias: 'dahi', productId: 'p_curd' },
  { alias: 'paneer', productId: 'p_paneer' },
  { alias: 'butter', productId: 'p_butter' },

  { alias: 'biscuits', productId: 'p_biscuits' },
  { alias: 'biscuit', productId: 'p_biscuits' },
  { alias: 'namkeen', productId: 'p_namkeen' },
  { alias: 'bread', productId: 'p_bread' },
  { alias: 'tea', productId: 'p_tea' },
  { alias: 'chai', productId: 'p_tea' },
  { alias: 'coffee', productId: 'p_coffee' },

  { alias: 'spinach', productId: 'p_spinach' },
  { alias: 'palak', productId: 'p_spinach' },
  { alias: 'curry leaves', productId: 'p_curry_leaves' },
  { alias: 'kadi patta', productId: 'p_curry_leaves' },
  { alias: 'carrot', productId: 'p_carrot' },
  { alias: 'carrots', productId: 'p_carrot' },

  // Telugu — what gets said at home
  { alias: 'biyyam', productId: 'p_rice' },
  { alias: 'pappu', productId: 'p_toor_dal' },
  { alias: 'kandi pappu', productId: 'p_toor_dal' },
  { alias: 'pesara pappu', productId: 'p_moong_dal' },
  { alias: 'senaga pappu', productId: 'p_chana_dal' },
  { alias: 'nune', productId: 'p_sunflower_oil' },
  { alias: 'neyyi', productId: 'p_ghee' },
  { alias: 'perugu', productId: 'p_curd' },
  { alias: 'palu', productId: 'p_milk' },
  { alias: 'uppu', productId: 'p_salt' },
  { alias: 'chakkera', productId: 'p_sugar' },
  { alias: 'pasupu', productId: 'p_turmeric' },
  { alias: 'karam', productId: 'p_chilli_powder' },
  { alias: 'jeelakarra', productId: 'p_cumin' },
  { alias: 'avalu', productId: 'p_mustard_seeds' },
  { alias: 'dhaniyalu', productId: 'p_coriander_seeds' },
  { alias: 'kothimeera', productId: 'p_coriander_leaves' },
  { alias: 'kottimeera', productId: 'p_coriander_leaves' },
  { alias: 'karivepaku', productId: 'p_curry_leaves' },
  { alias: 'allam', productId: 'p_ginger' },
  { alias: 'vellulli', productId: 'p_garlic' },
  { alias: 'pachimirchi', productId: 'p_chilli' },
  { alias: 'ullipayalu', productId: 'p_onion' },
  { alias: 'tamatalu', productId: 'p_tomato' },
  { alias: 'bangaladumpa', productId: 'p_potato' },
  { alias: 'atukulu', productId: 'p_poha' },
  { alias: 'ravva', productId: 'p_sooji' },
];

const today = new Date().toISOString();

const pref = (p: Omit<Preference, 'lastConfirmedAt' | 'timesOverridden'>): Preference =>
  ({ lastConfirmedAt: today, timesOverridden: 0, ...p });

export const seedPreferences: Preference[] = [
  pref({ productId: 'p_rice', preferredBrand: 'Aashirvaad', preferredVariant: 'Sona Masoori', typicalQty: 5, typicalUnit: 'kg', typicalIntervalDays: 30, confidence: 0.95, timesConfirmed: 6 }),
  pref({ productId: 'p_tomato', typicalQty: 1, typicalUnit: 'kg', typicalIntervalDays: 5, confidence: 0.9, timesConfirmed: 5 }),
  pref({ productId: 'p_coriander_seeds', typicalQty: 100, typicalUnit: 'g', confidence: 0.7, timesConfirmed: 2 }),
  pref({ productId: 'p_toor_dal', preferredBrand: 'Tata Sampann', typicalQty: 1, typicalUnit: 'kg', typicalIntervalDays: 21, confidence: 0.85, timesConfirmed: 4 }),
  pref({ productId: 'p_sunflower_oil', preferredBrand: 'Fortune', typicalQty: 1, typicalUnit: 'L', confidence: 0.8, timesConfirmed: 3 }),
  pref({ productId: 'p_curd', preferredBrand: 'Amul', typicalQty: 400, typicalUnit: 'g', confidence: 0.75, timesConfirmed: 3 }),
];

/** "coriander" in this house usually means seeds (still asked in v1 — see plan_04). */
export const seedAliasPreferences: AliasPreference[] = [
  { disambiguationGroup: 'coriander', productId: 'p_coriander_seeds', confidence: 0.7, lastConfirmedAt: today, timesConfirmed: 2, timesOverridden: 0 },
];

export const seedInventory: InventoryEntry[] = [
  { productId: 'p_rice', state: 'available', approxQty: 2, approxUnit: 'kg', updatedAt: today },
  { productId: 'p_toor_dal', state: 'running_low', approxQty: 200, approxUnit: 'g', updatedAt: today },
  { productId: 'p_sunflower_oil', state: 'available', approxQty: 500, approxUnit: 'ml', updatedAt: today },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

const bought = (id: string, productId: string, product: string, qty: number, unit: string, brand: string | null, days: number): Purchase =>
  ({ id, productId, product, qty, unit, brand, purchasedAt: daysAgo(days) });

/** Newest first. Curd (weekly) and onions (~10 days) have enough history to be predicted due (plan_10); dal isn't due yet. */
export const seedHistory: Purchase[] = [
  bought('h3', 'p_curd', 'Curd', 400, 'g', 'Amul', 8),
  bought('h4', 'p_onion', 'Onions', 1, 'kg', null, 11),
  bought('h5', 'p_curd', 'Curd', 400, 'g', 'Amul', 15),
  bought('h6', 'p_toor_dal', 'Toor dal', 1, 'kg', 'Tata Sampann', 18),
  bought('h7', 'p_onion', 'Onions', 1, 'kg', null, 21),
  bought('h8', 'p_curd', 'Curd', 400, 'g', 'Amul', 22),
  bought('h9', 'p_curd', 'Curd', 400, 'g', 'Amul', 29),
  bought('h10', 'p_onion', 'Onions', 1, 'kg', null, 32),
  bought('h11', 'p_toor_dal', 'Toor dal', 1, 'kg', 'Tata Sampann', 39),
  bought('h12', 'p_toor_dal', 'Toor dal', 1, 'kg', 'Tata Sampann', 61),
  {
    id: 'h1',
    productId: 'p_biscuits',
    product: 'Biscuits',
    qty: 2,
    unit: 'pack',
    brand: 'Parle-G',
    purchasedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: 'h2',
    productId: 'p_milk',
    product: 'Milk',
    qty: 1,
    unit: 'L',
    brand: 'Amul',
    purchasedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

export const initialHouseholdState: HouseholdState = {
  products: seedProducts,
  aliases: seedAliases,
  preferences: seedPreferences,
  aliasPreferences: seedAliasPreferences,
  inventory: seedInventory,
  list: { id: 'list_1', status: 'draft', createdAt: today },
  listItems: [],
  dismissedRestocks: {},
  dismissedPredictions: {},
  history: seedHistory,
  pendingClarifications: [],
  turns: [
    {
      id: 't0',
      role: 'agent',
      text: "Hi! Tell me what to add — e.g. 'get coriander' or 'tomatoes I don't know how much'.",
      at: today,
    },
  ],
};
