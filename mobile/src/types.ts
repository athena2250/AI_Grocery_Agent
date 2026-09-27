export type Category =
  | 'Vegetables'
  | 'Fruits'
  | 'Grains & Rice'
  | 'Pulses & Dal'
  | 'Spices'
  | 'Oils'
  | 'Dairy'
  | 'Snacks'
  | 'Bakery'
  | 'Beverages'
  | 'Other';

export type InventoryState = 'available' | 'running_low' | 'almost_finished' | 'out';
export type Confidence = 'high' | 'medium' | 'low';
export type Source = 'user' | 'household_memory' | 'purchase_history' | 'guess';

export type Intent =
  | 'ADD_ITEMS'
  | 'UPDATE_INVENTORY'
  | 'MARK_PURCHASED'
  | 'SHOW_LIST'
  | 'CLARIFY_RESPONSE'
  | 'UNKNOWN';

export interface Product {
  id: string;
  name: string;
  category: Category;
  defaultUnit: string;
}

export interface ProductAlias {
  alias: string;
  productId: string;
  disambiguationGroup?: string;
}

/**
 * Household memory (plan_05). Mirrors the `preference` table column-for-column
 * (camelCased); the sandbox is single-household so `household_id` is implicit.
 * `confidence` is the stored score — read it through `effectiveConfidence()`
 * so staleness decay applies.
 */
export interface Preference {
  productId: string;
  preferredBrand?: string;
  preferredVariant?: string;
  typicalQty?: number;
  typicalUnit?: string;
  typicalIntervalDays?: number;
  confidence: number;
  lastConfirmedAt: string;
  timesConfirmed: number;
  timesOverridden: number;
}

/** Mirrors `alias_preference`: this household's default for a disambiguation group ("coriander" → seeds). */
export interface AliasPreference {
  disambiguationGroup: string;
  productId: string;
  confidence: number;
  lastConfirmedAt: string;
  timesConfirmed: number;
  timesOverridden: number;
}

export interface InventoryEntry {
  productId: string;
  state: InventoryState;
  approxQty?: number;
  approxUnit?: string;
}

export interface ListItem {
  id: string;
  productId: string;
  product: string;
  category: Category;
  qty: number | null;
  unit: string | null;
  brand: string | null;
  variant: string | null;
  confidence: Confidence;
  source: Source;
  rationale: string;
  purchased: boolean;
}

export interface Purchase {
  id: string;
  productId: string;
  product: string;
  qty: number | null;
  unit: string | null;
  brand: string | null;
  purchasedAt: string;
}

export interface ProposedItem {
  id: string;
  productId: string;
  product: string;
  category: Category;
  qty: number | null;
  unit: string | null;
  brand: string | null;
  variant: string | null;
  confidence: Confidence;
  source: Source;
  rationale: string;
  needsConfirmation: boolean;
  savePreferenceOffer?: boolean;
}

export interface Clarification {
  id: string;
  itemRawText: string;
  kind: 'product_type' | 'quantity' | 'brand' | 'package_size' | 'usual_unresolved' | 'product_identity' | 'save_pref';
  question: string;
  options: string[];
  productId?: string;
  /** The option pre-filled from household memory. Picking it confirms that memory; picking another overrides it (plan_05). */
  suggestedOption?: string;
}

/** The user corrected a list item to a different product ("no, seeds not powder"). */
export interface ItemCorrection {
  itemId: string;
  productId: string;
  disambiguationGroup?: string;
}

export interface InventoryUpdate {
  productId: string;
  state: InventoryState;
  approxQty?: number;
  approxUnit?: string;
}

export interface AIResponse {
  reply: string;
  intent: Intent;
  proposedItems: ProposedItem[];
  clarifications: Clarification[];
  inventoryUpdates: InventoryUpdate[];
  purchasesMarked: string[];
  /** Id of the pending clarification this turn answered, if any (plan_04 turn state). */
  resolvedClarificationId?: string;
  /** Which option of the resolved clarification the user picked, echoed so the state layer can apply gated memory writes. */
  chosenOption?: string;
  corrections?: ItemCorrection[];
}

export interface HouseholdState {
  products: Product[];
  aliases: ProductAlias[];
  preferences: Preference[];
  aliasPreferences: AliasPreference[];
  inventory: InventoryEntry[];
  listItems: ListItem[];
  history: Purchase[];
  pendingClarifications: Clarification[];
  turns: Turn[];
}

export interface Turn {
  id: string;
  role: 'user' | 'agent';
  text: string;
  chips?: string[];
  /** Clarification this agent turn asked; its chips stay live while it's pending. */
  clarificationId?: string;
  at: string;
}

export interface ChatContext {
  recentItems: ListItem[];
  preferences: Preference[];
  aliasPreferences: AliasPreference[];
  inventory: InventoryEntry[];
  draftList: ListItem[];
  pendingClarifications: Clarification[];
  products: Product[];
  aliases: ProductAlias[];
  history: Purchase[];
  /** Set when the user tapped a chip — which pending clarification it answers. */
  answeringClarificationId?: string;
}
