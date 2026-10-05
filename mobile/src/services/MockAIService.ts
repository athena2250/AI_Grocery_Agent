import type {
  AIResponse,
  ChatContext,
  Clarification,
  Preference,
  Product,
  ProductAlias,
  ProposedItem,
} from '../types';
import type { AIService } from './AIService';
import { confidenceLevel, getAliasPreference, getPreferences } from '../state/memory';
import { INVENTORY_STATE_LABEL, needsRestock } from '../state/inventory';
import { parseInventoryPhrase } from './inventoryPhrases';
import { CATEGORY_ORDER } from '../state/planner';
import { extractItemName, guessCategory, newProduct, titleCase } from '../state/catalog';

let counter = 0;
const uid = (p: string) => `${p}_${Date.now()}_${counter++}`;

const norm = (s: string) => s.toLowerCase().trim().replace(/[?.!,]/g, '');

function findAliasMatches(text: string, aliases: ProductAlias[]): ProductAlias[] {
  const t = norm(text);
  const words = t.split(/\s+/);
  // Longest alias first so "coriander seeds" beats "coriander"
  const sorted = [...aliases].sort((a, b) => b.alias.length - a.alias.length);
  const hit = sorted.find((a) => {
    const al = norm(a.alias);
    if (al.includes(' ')) return t.includes(al);
    return words.includes(al);
  });
  if (!hit) return [];
  // Return all aliases with the same surface form (for disambiguation groups)
  return sorted.filter((a) => norm(a.alias) === norm(hit.alias));
}

/** The brand Mom named by saying it instead of the product ("get surf excel" → Surf Excel), if any. */
function brandIn(text: string, productId: string, aliases: ProductAlias[]): string | undefined {
  return findAliasMatches(text, aliases).find((a) => a.productId === productId)?.brand;
}

function parseQuantity(text: string): { qty: number; unit: string } | null {
  const t = norm(text).replace(/\s+/g, ' ');
  // e.g. "100g", "100 g", "1 kg", "2kg", "1/2 kg", "half kg", "500ml", "1 l"
  const halfMatch = t.match(/(½|half|1\/2)\s*(kg|g|l|ml|litre|liter|pack|dozen|pcs|bunch|loaf)/);
  if (halfMatch) return { qty: 0.5, unit: normalizeUnit(halfMatch[2]) };
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|litre|liter|pack|dozen|pcs|bunch|loaf)/);
  if (m) return { qty: parseFloat(m[1]), unit: normalizeUnit(m[2]) };
  return null;
}

function normalizeUnit(u: string): string {
  const x = u.toLowerCase();
  if (x === 'litre' || x === 'liter' || x === 'l') return 'L';
  return x;
}

function productById(products: Product[], id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

/** Household memory for one product, confidence already decayed for staleness. */
function preferenceFor(prefs: Preference[], productId: string): Preference | undefined {
  return getPreferences(prefs, [productId])[productId];
}

const usualText = (p: Preference) => `${p.typicalQty} ${p.typicalUnit}${p.preferredBrand ? ` ${p.preferredBrand}` : ''}`;

function reply(text: string, patch: Partial<AIResponse> = {}): AIResponse {
  return {
    reply: text,
    intent: 'UNKNOWN',
    proposedItems: [],
    clarifications: [],
    inventoryUpdates: [],
    purchasesMarked: [],
    ...patch,
  };
}

function askProductType(rawText: string, matches: ProductAlias[], ctx: ChatContext): AIResponse {
  const options = matches
    .map((m) => productById(ctx.products, m.productId)?.name)
    .filter((n): n is string => !!n);
  // v1 always asks; memory only marks the likely chip and says so.
  const group = matches.find((m) => m.disambiguationGroup)?.disambiguationGroup;
  const remembered = group ? getAliasPreference(ctx.aliasPreferences, group) : undefined;
  const suggestedOption = remembered && productById(ctx.products, remembered.productId)?.name;
  const clar: Clarification = {
    id: uid('cl'),
    itemRawText: rawText,
    kind: 'product_type',
    question: `Did you mean ${options.join(', ')}?`,
    options,
    ...(suggestedOption && options.includes(suggestedOption) ? { suggestedOption } : {}),
  };
  const hint = clar.suggestedOption ? ` (You usually get ${clar.suggestedOption.toLowerCase()}.)` : '';
  const brand = matches.find((m) => m.brand)?.brand;
  return reply(`${brand ? `${brand} — which` : 'Which'} one — ${options.join(' / ')}?${hint}`, {
    intent: 'ADD_ITEMS',
    clarifications: [clar],
  });
}

function askQuantity(rawText: string, product: Product, defaultQty?: number, defaultUnit?: string): AIResponse {
  const unit = defaultUnit ?? product.defaultUnit;
  const bases = unit === 'g' ? [50, 100, 200] : unit === 'kg' ? [0.5, 1, 2] : unit === 'L' ? [0.5, 1, 2] : [1, 2, 3];
  const options = bases.map((n) => `${n} ${unit}`);
  const suggestedOption = defaultQty != null ? `${defaultQty} ${unit}` : undefined;
  // The remembered amount is always a chip, so confirming memory is one tap.
  if (suggestedOption && !options.includes(suggestedOption)) options.unshift(suggestedOption);
  options.push('custom');
  const clar: Clarification = {
    id: uid('cl'),
    itemRawText: rawText,
    kind: 'quantity',
    question: `How much ${product.name.toLowerCase()}?`,
    options,
    productId: product.id,
    ...(suggestedOption && options.includes(suggestedOption) ? { suggestedOption } : {}),
  };
  const suggestion = defaultQty ? ` (you usually get ${defaultQty} ${unit})` : '';
  return reply(`How much ${product.name.toLowerCase()}?${suggestion}`, {
    intent: 'ADD_ITEMS',
    clarifications: [clar],
  });
}

function askBrand(rawText: string, product: Product): AIResponse {
  const options = product.id === 'p_biscuits'
    ? ['Parle-G', 'Britannia Marie', 'Good Day', 'other']
    : ['other'];
  const clar: Clarification = {
    id: uid('cl'),
    itemRawText: rawText,
    kind: 'brand',
    question: `Which brand of ${product.name.toLowerCase()}?`,
    options,
    productId: product.id,
  };
  return reply(`I don't have a usual brand saved for ${product.name.toLowerCase()} yet. Which one?`, {
    intent: 'ADD_ITEMS',
    clarifications: [clar],
  });
}

function askSavePref(product: Product, qty: number, unit: string, brand?: string): Clarification {
  return {
    id: uid('cl'),
    itemRawText: product.name,
    kind: 'save_pref',
    question: `Save ${qty} ${unit}${brand ? ` ${brand}` : ''} as usual for ${product.name.toLowerCase()}?`,
    options: ['Yes, save', 'No thanks'],
    productId: product.id,
  };
}

function makeProposed(
  product: Product,
  qty: number | null,
  unit: string | null,
  opts: {
    brand?: string | null;
    variant?: string | null;
    source: ProposedItem['source'];
    confidence: ProposedItem['confidence'];
    rationale: string;
  },
): ProposedItem {
  return {
    id: uid('it'),
    productId: product.id,
    product: product.name,
    category: product.category,
    qty,
    unit,
    brand: opts.brand ?? null,
    variant: opts.variant ?? null,
    confidence: opts.confidence,
    source: opts.source,
    rationale: opts.rationale,
    needsConfirmation: opts.confidence !== 'high',
  };
}

const SHOW_LIST_RE = /^show( me)? (the )?list$|^list$|what'?s on the list/;

function matchOption(clar: Clarification, text: string): string | undefined {
  const t = norm(text);
  const exact = clar.options.find((o) => norm(o) === t);
  if (exact) return exact;
  // "seeds" → "Coriander seeds", only when exactly one option contains every word typed.
  if (clar.kind === 'product_type') {
    const words = t.split(/\s+/);
    const hits = clar.options.filter((o) => words.every((w) => norm(o).split(/\s+/).includes(w)));
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

/**
 * Which pending clarification (if any) this message answers.
 * A tapped chip names its clarification. Typed text answers the newest question
 * whose option it matches; free text (a custom quantity or a brand name) answers
 * only the newest question, and only when it isn't a new request. Anything else
 * is an unrelated request, and the old questions stay pending (plan_04).
 */
function pickPending(text: string, ctx: ChatContext): Clarification | undefined {
  const pending = ctx.pendingClarifications;
  if (ctx.answeringClarificationId) {
    return pending.find((c) => c.id === ctx.answeringClarificationId);
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    if (matchOption(pending[i], text)) return pending[i];
  }
  const newest = pending[pending.length - 1];
  if (!newest) return undefined;
  if (findAliasMatches(text, ctx.aliases).length > 0 || SHOW_LIST_RE.test(norm(text))) return undefined;
  if (newest.kind === 'quantity' && parseQuantity(text)) return newest;
  if (newest.kind === 'brand') return newest;
  return undefined;
}

function handleClarification(text: string, ctx: ChatContext): AIResponse | null {
  const pending = pickPending(text, ctx);
  if (!pending) return null;
  const r = resolveClarification(pending, text, ctx);
  return r && { ...r, resolvedClarificationId: pending.id, chosenOption: matchOption(pending, text) };
}

function resolveClarification(pending: Clarification, text: string, ctx: ChatContext): AIResponse | null {
  const matchedOption = matchOption(pending, text);

  if (pending.kind === 'product_type') {
    if (!matchedOption) return null;
    const chosenProduct = ctx.products.find((p) => norm(p.name) === norm(matchedOption));
    if (!chosenProduct) return null;
    const pref = preferenceFor(ctx.preferences, chosenProduct.id);
    // The original words go along, so a brand said there ("surf excel") survives the quantity question.
    const ask = askQuantity(pending.itemRawText, chosenProduct, pref?.typicalQty, pref?.typicalUnit);
    if (pref?.typicalQty && pref.typicalUnit) {
      // v1 always-ask: propose the remembered amount, but still confirm it with chips.
      const proposed = makeProposed(chosenProduct, pref.typicalQty, pref.typicalUnit, {
        brand: brandIn(pending.itemRawText, chosenProduct.id, ctx.aliases) ?? pref.preferredBrand,
        variant: pref.preferredVariant,
        source: 'household_memory',
        confidence: confidenceLevel(pref.confidence),
        rationale: `You usually get ${usualText(pref)}.`,
      });
      // The quantity answer refines this item rather than adding a second one.
      const clarifications = ask.clarifications.map((c) => ({ ...c, itemId: proposed.id }));
      return { ...ask, intent: 'CLARIFY_RESPONSE', proposedItems: [proposed], clarifications };
    }
    return { ...ask, intent: 'CLARIFY_RESPONSE' };
  }

  if (pending.kind === 'quantity') {
    const productId = pending.productId!;
    const product = productById(ctx.products, productId)!;
    let qty: number | null = null;
    let unit: string | null = null;
    if (matchedOption && matchedOption !== 'custom') {
      const parsed = parseQuantity(matchedOption);
      if (parsed) { qty = parsed.qty; unit = parsed.unit; }
    } else {
      const parsed = parseQuantity(text);
      if (parsed) { qty = parsed.qty; unit = parsed.unit; }
    }
    if (qty == null || unit == null) {
      return reply(`Sorry, I didn't catch a quantity. Try like "100 g" or "1 kg".`, {
        intent: 'CLARIFY_RESPONSE',
        clarifications: [pending],
      });
    }
    const pref = preferenceFor(ctx.preferences, productId);
    const brand = brandIn(pending.itemRawText, productId, ctx.aliases) ?? pref?.preferredBrand;
    const proposed = {
      ...makeProposed(product, qty, unit, {
        brand,
        source: 'user',
        confidence: 'high',
        rationale: `You said ${qty} ${unit}.`,
      }),
      // Same id as the provisional item this question was confirming → the planner replaces it.
      ...(pending.itemId ? { id: pending.itemId } : {}),
    };
    const savePref = askSavePref(product, qty, unit, brand);
    return reply(`Added ${brand ? `${brand} ` : ''}${product.name.toLowerCase()} — ${qty} ${unit}. Save as usual?`, {
      intent: 'CLARIFY_RESPONSE',
      proposedItems: [proposed],
      clarifications: [savePref],
    });
  }

  if (pending.kind === 'save_pref') {
    if (!matchedOption) return null;
    if (matchedOption.startsWith('Yes')) {
      return reply(`Saved. I'll remember that.`, { intent: 'CLARIFY_RESPONSE' });
    }
    return reply(`Okay, not saving.`, { intent: 'CLARIFY_RESPONSE' });
  }

  if (pending.kind === 'restock') {
    if (!matchedOption) return null;
    const product = productById(ctx.products, pending.productId!)!;
    if (matchedOption === 'Not now') return reply(`Okay, not adding ${product.name.toLowerCase()}.`, { intent: 'CLARIFY_RESPONSE' });
    // Already added from the List screen's pantry suggestion — don't add it twice.
    if (ctx.draftList.some((i) => i.productId === product.id)) {
      return reply(`${product.name} is already on the list.`, { intent: 'CLARIFY_RESPONSE' });
    }
    const pref = preferenceFor(ctx.preferences, product.id);
    if (matchedOption === pending.suggestedOption && pref?.typicalQty && pref.typicalUnit) {
      const state = ctx.inventory.find((i) => i.productId === product.id)?.state ?? 'almost_finished';
      const proposed = makeProposed(product, pref.typicalQty, pref.typicalUnit, {
        brand: pref.preferredBrand,
        variant: pref.preferredVariant,
        source: 'household_memory',
        confidence: confidenceLevel(pref.confidence),
        rationale: `You said ${product.name.toLowerCase()} is ${INVENTORY_STATE_LABEL[state]} — you usually get ${usualText(pref)}.`,
      });
      return reply(`Added ${usualText(pref)} ${product.name.toLowerCase()} to the list.`, {
        intent: 'CLARIFY_RESPONSE',
        proposedItems: [proposed],
      });
    }
    return { ...askQuantity(product.name, product, pref?.typicalQty, pref?.typicalUnit), intent: 'CLARIFY_RESPONSE' };
  }

  if (pending.kind === 'category') {
    const category = CATEGORY_ORDER.find((c) => c === matchedOption);
    const name = extractItemName(pending.itemRawText);
    if (!category || !name) return null;
    // The state layer files this product when it sees the answer; same name → same id.
    const product = newProduct(name, category);
    const where = category === 'Other' ? 'under Other' : `under ${category}`;
    const parsed = parseQuantity(pending.itemRawText);
    if (parsed) {
      const proposed = makeProposed(product, parsed.qty, parsed.unit, {
        source: 'user',
        confidence: 'high',
        rationale: `You said ${parsed.qty} ${parsed.unit}. You put ${product.name} ${where}.`,
      });
      return reply(`Added ${product.name} — ${parsed.qty} ${parsed.unit}, ${where}. I'll remember where it goes.`, {
        intent: 'CLARIFY_RESPONSE',
        proposedItems: [proposed],
      });
    }
    const ask = askQuantity(pending.itemRawText, product);
    return { ...ask, reply: `Okay, ${product.name} goes ${where} — I'll remember. ${ask.reply}`, intent: 'CLARIFY_RESPONSE' };
  }

  if (pending.kind === 'brand') {
    if (!matchedOption && !text.trim()) return null;
    const brand = matchedOption && matchedOption !== 'other' ? matchedOption : text.trim();
    const product = productById(ctx.products, pending.productId!)!;
    const pref = preferenceFor(ctx.preferences, product.id);
    const qty = pref?.typicalQty ?? 1;
    const unit = pref?.typicalUnit ?? product.defaultUnit;
    const proposed = makeProposed(product, qty, unit, {
      brand,
      source: 'user',
      confidence: 'medium',
      rationale: `You chose ${brand}.`,
    });
    const savePref = askSavePref(product, qty, unit, brand);
    return reply(`Added ${brand} ${product.name.toLowerCase()}. Save as usual?`, {
      intent: 'CLARIFY_RESPONSE',
      proposedItems: [proposed],
      clarifications: [savePref],
    });
  }

  return null;
}

function handleShowList(ctx: ChatContext): AIResponse | null {
  if (ctx.draftList.length === 0) {
    return reply(`Your list is empty right now.`, { intent: 'SHOW_LIST' });
  }
  const summary = ctx.draftList
    .map((i) => `• ${i.product}${i.qty ? ` ${i.qty} ${i.unit}` : ''}`)
    .join('\n');
  return reply(`Here's your list (${ctx.draftList.length} items):\n${summary}`, { intent: 'SHOW_LIST' });
}

function handleMarkPurchased(text: string, ctx: ChatContext): AIResponse | null {
  const t = norm(text);
  if (!/(mark|bought|purchased|got)/.test(t)) return null;
  const matches = findAliasMatches(text, ctx.aliases);
  if (matches.length === 0) return null;
  const productIds = new Set(matches.map((m) => m.productId));
  const items = ctx.draftList.filter((i) => productIds.has(i.productId));
  if (items.length > 0) {
    // The state layer flips these to `available` in the pantry when it records the purchase.
    return reply(`Marked ${items.map((i) => i.product.toLowerCase()).join(', ')} purchased.`, {
      intent: 'MARK_PURCHASED',
      purchasesMarked: items.map((i) => i.id),
    });
  }
  // Bought something that wasn't on the list: nothing to tick off, but the pantry should know.
  if (matches.length === 1) {
    const product = productById(ctx.products, matches[0].productId)!;
    return reply(`${product.name} wasn't on the list — marked it as stocked up in the pantry.`, {
      intent: 'UPDATE_INVENTORY',
      inventoryUpdates: [{ productId: product.id, state: 'available' }],
    });
  }
  return reply(`I don't see that on your list.`, { intent: 'MARK_PURCHASED' });
}

/** "Add rice to the list?" — the planner's buy signal, as a proposal the user confirms (plan_06). */
function askRestock(product: Product, pref: Preference | undefined): Clarification {
  const remembered = pref?.typicalQty && pref.typicalUnit ? `Yes, ${usualText(pref)}` : undefined;
  return {
    id: uid('cl'),
    itemRawText: product.name,
    kind: 'restock',
    question: `Add ${product.name.toLowerCase()} to the list?`,
    options: remembered ? [remembered, 'Other amount', 'Not now'] : ['Yes, add', 'Not now'],
    productId: product.id,
    ...(remembered ? { suggestedOption: remembered } : {}),
  };
}

function handleInventoryUpdate(text: string, ctx: ChatContext): AIResponse | null {
  const phrase = parseInventoryPhrase(text);
  if (!phrase) return null;
  const matches = findAliasMatches(text, ctx.aliases);
  if (matches.length === 0) return null;
  if (matches.length > 1) return askProductType(text, matches, ctx);

  const product = productById(ctx.products, matches[0].productId)!;
  const amount = phrase.approxQty != null ? ` (about ${phrase.approxQty} ${phrase.approxUnit} left)` : '';
  const marked = `Got it — marked ${product.name.toLowerCase()} ${INVENTORY_STATE_LABEL[phrase.state]}${amount}.`;
  const update = { intent: 'UPDATE_INVENTORY' as const, inventoryUpdates: [{ productId: product.id, ...phrase }] };

  if (!needsRestock(phrase.state)) return reply(marked, update);
  if (ctx.draftList.some((i) => i.productId === product.id)) {
    return reply(`${marked} It's already on the list.`, update);
  }
  const pref = preferenceFor(ctx.preferences, product.id);
  const clar = askRestock(product, pref);
  const hint = clar.suggestedOption && pref ? ` You usually get ${usualText(pref)}.` : '';
  return reply(`${marked} Add it to the list?${hint}`, { ...update, clarifications: [clar] });
}

const CORRECTION_RE = /^(no|nope|nahi)\b|\bnot\b/;
const CORRECTION_FILLER = new Set(['no', 'nope', 'nahi', 'get', 'the', 'i', 'meant', 'mean', 'want', 'it', 'its', 'one', 'please', 'actually']);

/**
 * "no, seeds not powder" / "not powder, seeds": swap the newest list item from a
 * disambiguation group for the sibling the user named. Needs exactly one match —
 * anything vaguer falls through to the normal handlers.
 */
function handleCorrection(text: string, ctx: ChatContext): AIResponse | null {
  const t = norm(text);
  if (!CORRECTION_RE.test(t)) return null;
  const wanted = t.replace(/\bnot\s+\w+/g, ' ').split(/\s+/).filter((w) => w && !CORRECTION_FILLER.has(w));
  if (wanted.length === 0) return null;

  for (const item of [...ctx.draftList].reverse()) {
    const group = ctx.aliases.find((a) => a.productId === item.productId && a.disambiguationGroup)?.disambiguationGroup;
    if (!group) continue;
    const siblings = [...new Set(ctx.aliases.filter((a) => a.disambiguationGroup === group).map((a) => a.productId))]
      .filter((id) => id !== item.productId)
      .map((id) => productById(ctx.products, id))
      .filter((p): p is Product => !!p);
    const hits = siblings.filter((p) => wanted.every((w) => norm(p.name).split(/\s+/).includes(w)));
    if (hits.length !== 1) continue;
    const next = hits[0];
    const proposed = makeProposed(next, item.qty, item.unit, {
      source: 'user',
      confidence: 'high',
      rationale: `You corrected ${item.product.toLowerCase()} to ${next.name.toLowerCase()}.`,
    });
    const amount = item.qty ? ` (${item.qty} ${item.unit})` : '';
    return reply(`Sorry — switched to ${next.name.toLowerCase()}${amount}. I'll remember "${group}" means ${next.name.toLowerCase()}.`, {
      intent: 'ADD_ITEMS',
      proposedItems: [proposed],
      corrections: [{ itemId: item.id, productId: next.id, disambiguationGroup: group }],
    });
  }
  return null;
}

/**
 * "get harpic" for something the catalog doesn't know: ask where it goes, the
 * keyword guess as the pre-filled chip. Nothing is filed until Mom taps — the
 * answer teaches the catalog (reducer `learnCatalog`).
 */
function handleUnknownItem(text: string): AIResponse | null {
  const name = extractItemName(text);
  if (!name) return null;
  const guess = guessCategory(name);
  const rest = CATEGORY_ORDER.filter((c) => c !== guess && c !== 'Other');
  const options = guess ? [guess, ...rest, 'Other'] : [...rest, 'Other'];
  const label = titleCase(name);
  const clar: Clarification = {
    id: uid('cl'),
    itemRawText: text,
    kind: 'category',
    question: `Where does ${label} go?`,
    options,
    ...(guess ? { suggestedOption: guess } : {}),
  };
  const hint = guess ? ` Looks like ${guess} to me.` : '';
  return reply(`I don't know ${label} yet — which section should it go in?${hint}`, {
    intent: 'ADD_ITEMS',
    clarifications: [clar],
  });
}

function handleAddItems(text: string, ctx: ChatContext): AIResponse | null {
  const t = norm(text);
  const usual = /\busual\b|\bsame as usual\b|\blike always\b/.test(t);

  const matches = findAliasMatches(text, ctx.aliases);
  if (matches.length === 0) return null;

  // Ambiguity: alias maps to multiple products
  if (matches.length > 1) {
    return askProductType(text, matches, ctx);
  }

  const product = productById(ctx.products, matches[0].productId)!;
  const pref = preferenceFor(ctx.preferences, product.id);
  const parsedQty = parseQuantity(text);
  // A brand said now beats the remembered one (principle 7).
  const saidBrand = matches[0].brand;

  // "usual biscuits" style — needs something remembered to stand on.
  if (usual) {
    if (!pref?.preferredBrand && pref?.typicalQty == null) return askBrand(text, product);
    const qty = pref.typicalQty ?? 1;
    const unit = pref.typicalUnit ?? product.defaultUnit;
    const what = [pref.preferredBrand, pref.preferredVariant && `(${pref.preferredVariant})`].filter(Boolean).join(' ');
    const proposed = makeProposed(product, qty, unit, {
      brand: pref.preferredBrand,
      variant: pref.preferredVariant,
      source: 'household_memory',
      confidence: confidenceLevel(pref.confidence),
      rationale: `Your usual: ${what ? `${what}, ` : ''}${qty} ${unit}.`,
    });
    return reply(`Added your usual ${product.name.toLowerCase()} — ${pref.preferredBrand ? `${pref.preferredBrand}, ` : ''}${qty} ${unit}.`, {
      intent: 'ADD_ITEMS',
      proposedItems: [proposed],
    });
  }

  // Explicit quantity in the message
  if (parsedQty) {
    const proposed = makeProposed(product, parsedQty.qty, parsedQty.unit, {
      brand: saidBrand ?? pref?.preferredBrand,
      source: 'user',
      confidence: 'high',
      rationale: `You said ${saidBrand ? `${saidBrand}, ` : ''}${parsedQty.qty} ${parsedQty.unit}.`,
    });
    return reply(`Added ${saidBrand ? `${saidBrand} ` : ''}${product.name.toLowerCase()} — ${parsedQty.qty} ${parsedQty.unit}.`, {
      intent: 'ADD_ITEMS',
      proposedItems: [proposed],
    });
  }

  // "don't know how much" style → propose from memory or ask
  const dontKnow = /don'?t know|dunno|not sure|no idea|any/.test(t);
  if (dontKnow && pref?.typicalQty && pref.typicalUnit) {
    const { typicalQty: qty, typicalUnit: unit } = pref;
    const proposed = makeProposed(product, qty, unit, {
      brand: saidBrand ?? pref.preferredBrand,
      source: 'household_memory',
      confidence: confidenceLevel(pref.confidence),
      rationale: `You usually get ${qty} ${unit}.`,
    });
    // Also offer quick alternates
    const clar: Clarification = {
      id: uid('cl'),
      itemRawText: text,
      kind: 'quantity',
      question: `Go with ${qty} ${unit}?`,
      options: [`Yes ${qty} ${unit}`, `½ ${unit}`, `2 ${unit}`, 'custom'],
      productId: product.id,
      suggestedOption: `Yes ${qty} ${unit}`,
      itemId: proposed.id,
    };
    return reply(`Proposing ${qty} ${unit} of ${product.name.toLowerCase()} — that's your usual.`, {
      intent: 'ADD_ITEMS',
      proposedItems: [proposed],
      clarifications: [clar],
    });
  }

  // No quantity given → ask
  return askQuantity(text, product, pref?.typicalQty, pref?.typicalUnit);
}

/** Adding to an approved list puts it back to draft (plan_08) — say so, so it's never a surprise. */
function noteReopen(r: AIResponse, ctx: ChatContext): AIResponse {
  if (ctx.listStatus !== 'approved' || r.proposedItems.length === 0) return r;
  return { ...r, reply: `${r.reply}\n(Your list was approved — this puts it back to draft. Approve it again when you're done.)` };
}

export class MockAIService implements AIService {
  async chat(text: string, ctx: ChatContext): Promise<AIResponse> {
    return noteReopen(this.respond(text, ctx), ctx);
  }

  private respond(text: string, ctx: ChatContext): AIResponse {
    const trimmed = text.trim();
    if (!trimmed) return reply(`Say something — like "get rice" or "show list".`);

    // Before clarifications, so "no, seeds not powder" isn't swallowed as a free-text brand answer.
    const corrected = handleCorrection(trimmed, ctx);
    if (corrected) return corrected;

    const clarified = handleClarification(trimmed, ctx);
    if (clarified) return clarified;

    const t = norm(trimmed);
    if (SHOW_LIST_RE.test(t)) {
      const r = handleShowList(ctx);
      if (r) return r;
    }

    // Inventory first: "we still got plenty of rice" is a pantry statement, not a purchase.
    const inv = handleInventoryUpdate(trimmed, ctx);
    if (inv) return inv;

    const purchased = handleMarkPurchased(trimmed, ctx);
    if (purchased) return purchased;

    const add = handleAddItems(trimmed, ctx);
    if (add) return add;

    const unknown = handleUnknownItem(trimmed);
    if (unknown) return unknown;

    return reply(`I didn't catch that — could you say it another way? (Try "get tomatoes" or "rice is almost finished".)`);
  }
}
