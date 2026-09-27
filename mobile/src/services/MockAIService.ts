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
import { AUTO_SUGGEST_GATE, confidenceLevel, getAliasPreference, getPreferences } from '../state/memory';

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
  return reply(`Which one — ${options.join(' / ')}?${hint}`, {
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
    const ask = askQuantity(matchedOption, chosenProduct, pref?.typicalQty, pref?.typicalUnit);
    if (pref?.typicalQty && pref.typicalUnit) {
      // v1 always-ask: propose the remembered amount, but still confirm it with chips.
      const proposed = makeProposed(chosenProduct, pref.typicalQty, pref.typicalUnit, {
        brand: pref.preferredBrand,
        variant: pref.preferredVariant,
        source: 'household_memory',
        confidence: confidenceLevel(pref.confidence),
        rationale: `You usually get ${usualText(pref)}.`,
      });
      return { ...ask, intent: 'CLARIFY_RESPONSE', proposedItems: [proposed] };
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
    const proposed = makeProposed(product, qty, unit, {
      brand: pref?.preferredBrand,
      source: 'user',
      confidence: 'high',
      rationale: `You said ${qty} ${unit}.`,
    });
    const savePref = askSavePref(product, qty, unit, pref?.preferredBrand);
    return reply(`Added ${product.name.toLowerCase()} — ${qty} ${unit}. Save as usual?`, {
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
  const items = ctx.draftList.filter((i) => productIds.has(i.productId) && !i.purchased);
  if (items.length === 0) {
    return reply(`I don't see that on your list.`, { intent: 'MARK_PURCHASED' });
  }
  return reply(`Marked ${items.map((i) => i.product.toLowerCase()).join(', ')} purchased.`, {
    intent: 'MARK_PURCHASED',
    purchasesMarked: items.map((i) => i.id),
  });
}

function handleInventoryUpdate(text: string, ctx: ChatContext): AIResponse | null {
  const t = norm(text);
  const stateMatch =
    /almost finished|almost done|nearly done/.test(t) ? 'almost_finished' :
    /running low|low on|getting low/.test(t) ? 'running_low' :
    /out of|finished|over|khatam/.test(t) ? 'out' :
    /available|full|plenty/.test(t) ? 'available' :
    null;
  if (!stateMatch) return null;
  const matches = findAliasMatches(text, ctx.aliases);
  if (matches.length === 0) return null;
  if (matches.length > 1) return askProductType(text, matches, ctx);

  const product = productById(ctx.products, matches[0].productId)!;
  const invUpdate = { productId: product.id, state: stateMatch as 'available' | 'running_low' | 'almost_finished' | 'out' };

  const label = stateMatch.replace('_', ' ');
  const marked = `Got it — marked ${product.name.toLowerCase()} ${label}.`;
  if (stateMatch === 'available') {
    return reply(marked, { intent: 'UPDATE_INVENTORY', inventoryUpdates: [invUpdate] });
  }

  // Low/finished/out: re-add the usual only when memory clears the auto-suggest gate.
  const pref = preferenceFor(ctx.preferences, product.id);
  if (pref?.typicalQty && pref.typicalUnit && pref.confidence >= AUTO_SUGGEST_GATE) {
    const proposed = makeProposed(product, pref.typicalQty, pref.typicalUnit, {
      brand: pref.preferredBrand,
      variant: pref.preferredVariant,
      source: 'household_memory',
      confidence: confidenceLevel(pref.confidence),
      rationale: `${product.name} is ${label} — you usually get ${usualText(pref)}.`,
    });
    return reply(`${marked} Added ${usualText(pref)} to the list.`, {
      intent: 'UPDATE_INVENTORY',
      inventoryUpdates: [invUpdate],
      proposedItems: [proposed],
    });
  }
  if (pref?.typicalQty && pref.typicalUnit) {
    const ask = askQuantity(text, product, pref.typicalQty, pref.typicalUnit);
    return { ...ask, reply: `${marked} ${ask.reply}`, intent: 'UPDATE_INVENTORY', inventoryUpdates: [invUpdate] };
  }
  return reply(marked, { intent: 'UPDATE_INVENTORY', inventoryUpdates: [invUpdate] });
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
      brand: pref?.preferredBrand,
      source: 'user',
      confidence: 'high',
      rationale: `You said ${parsedQty.qty} ${parsedQty.unit}.`,
    });
    return reply(`Added ${product.name.toLowerCase()} — ${parsedQty.qty} ${parsedQty.unit}.`, {
      intent: 'ADD_ITEMS',
      proposedItems: [proposed],
    });
  }

  // "don't know how much" style → propose from memory or ask
  const dontKnow = /don'?t know|dunno|not sure|no idea|any/.test(t);
  if (dontKnow && pref?.typicalQty && pref.typicalUnit) {
    const { typicalQty: qty, typicalUnit: unit } = pref;
    const proposed = makeProposed(product, qty, unit, {
      brand: pref.preferredBrand,
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

export class MockAIService implements AIService {
  async chat(text: string, ctx: ChatContext): Promise<AIResponse> {
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

    const purchased = handleMarkPurchased(trimmed, ctx);
    if (purchased) return purchased;

    const inv = handleInventoryUpdate(trimmed, ctx);
    if (inv) return inv;

    const add = handleAddItems(trimmed, ctx);
    if (add) return add;

    return reply(`I didn't catch that — could you say it another way? (Try "get tomatoes" or "rice is almost finished".)`);
  }
}
