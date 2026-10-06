import type { AIResponse, ChatContext } from '../types';
import type { AIService } from './AIService';
import { MockAIService, namesSeveralProducts, noteReopen } from './MockAIService';

/**
 * The LLM where it earns its place (principle 4): the on-phone rules answer
 * first — instant, offline, and they own every question, chip and memory rule.
 * Only a message the rules don't recognise ("biyyam aipovachindi", "we need
 * some of that green chutney leaf") goes to the server's LLM, which extracts
 * what was meant; that is turned back into the plain commands the rules know
 * ("rice is almost finished", "get coriander leaves") and answered by them. If
 * the server or the LLM is unreachable, the rules' own fallback answers.
 */

/** Backend `LLMExtraction` (app/understanding/schema.py), as JSON. */
export interface Extraction {
  intent: 'ADD_ITEMS' | 'UPDATE_INVENTORY' | 'MARK_PURCHASED' | 'SHOW_LIST' | 'CLARIFY_RESPONSE' | 'UNKNOWN';
  items: {
    raw_text: string; canonical_guess?: string | null; qty?: number | null; unit?: string | null;
    brand?: string | null; variant_hint?: string | null;
  }[];
  inventory_updates: {
    raw_text: string; product_guess?: string | null;
    state: 'available' | 'running_low' | 'almost_finished' | 'out';
    approx_qty?: number | null; approx_unit?: string | null;
  }[];
  purchases_marked: string[];
}

export interface Command {
  text: string;
  /** An add may be for a product the catalog doesn't know yet — then the rules ask its section. */
  add: boolean;
}

const UNITS: [RegExp, string][] = [
  [/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/, 'kg'],
  [/^(g|gm|gms|gram|grams)$/, 'g'],
  [/^(l|ltr|litre|litres|liter|liters)$/, 'l'],
  [/^(ml|millilitre|milliliter|millilitres|milliliters)$/, 'ml'],
  [/^(pack|packs|packet|packets|pkt|pkts)$/, 'pack'],
  [/^(dozen|dozens)$/, 'dozen'],
  [/^(pc|pcs|piece|pieces|nos)$/, 'pcs'],
  [/^(bunch|bunches)$/, 'bunch'],
  [/^(loaf|loaves)$/, 'loaf'],
];

/** "2 kilos" → "2 kg"; units the rules can't read are dropped (they will ask how much). */
function amount(qty?: number | null, unit?: string | null): string {
  if (qty == null || !unit) return '';
  const u = UNITS.find(([re]) => re.test(unit.trim().toLowerCase()))?.[1];
  return u ? `${qty} ${u}` : '';
}

const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const MEMORY_HINTS = new Set(['usual', 'same', 'regular', 'same as last time']);

const STATE_PHRASE: Record<Extraction['inventory_updates'][number]['state'], (name: string) => string> = {
  almost_finished: (n) => `${n} is almost finished`,
  running_low: (n) => `${n} is running low`,
  out: (n) => `${n} is over`,
  available: (n) => `we have plenty of ${n}`,
};

/** The LLM's extraction → plain commands the rule engine already understands. Pure. */
export function toCommands(e: Extraction): Command[] {
  switch (e.intent) {
    case 'SHOW_LIST':
      return [{ text: 'show list', add: false }];
    case 'MARK_PURCHASED':
      return e.purchases_marked.map(clean).filter(Boolean).map((p) => ({ text: `mark ${p} purchased`, add: false }));
    case 'UPDATE_INVENTORY':
      return e.inventory_updates
        .map((u) => ({ u, name: clean(u.product_guess) || clean(u.raw_text) }))
        .filter(({ name }) => name)
        .map(({ u, name }) => ({ text: STATE_PHRASE[u.state](name), add: false }));
    case 'ADD_ITEMS':
      return e.items.map((i) => {
        let name = clean(i.canonical_guess) || clean(i.raw_text);
        const hint = clean(i.variant_hint).toLowerCase();
        if (MEMORY_HINTS.has(hint)) return { text: `get the usual ${name}`, add: true };
        if (hint && !name.toLowerCase().includes(hint)) name = `${name} ${hint}`;
        return { text: ['get', amount(i.qty, i.unit), clean(i.brand), name].filter(Boolean).join(' '), add: true };
      }).filter((c) => c.text !== 'get');
    default:
      // CLARIFY_RESPONSE / UNKNOWN: answers to questions are the rules' job; nothing to add.
      return [];
  }
}

/** One reply for several commands ("add coriander and tomatoes"). */
export function mergeResponses(rs: AIResponse[]): AIResponse | null {
  if (!rs.length) return null;
  if (rs.length === 1) return rs[0];
  return {
    ...rs[0],
    reply: rs.map((r) => r.reply).join('\n'),
    proposedItems: rs.flatMap((r) => r.proposedItems),
    clarifications: rs.flatMap((r) => r.clarifications),
    inventoryUpdates: rs.flatMap((r) => r.inventoryUpdates),
    purchasesMarked: rs.flatMap((r) => r.purchasesMarked),
    corrections: rs.flatMap((r) => r.corrections ?? []),
  };
}

/**
 * "tamatar aur dahi", "rice, dal and oil": the rules take one item per message and may
 * recognise only some of the names, silently dropping the rest — so the LLM splits these.
 */
const JOINED = /,|&|\b(and|aur|or|mariyu|mattu|plus)\b/;

export class HybridAIService implements AIService {
  constructor(
    private understand: (text: string) => Promise<Extraction | null>,
    private rules: MockAIService = new MockAIService(),
  ) {}

  async chat(text: string, ctx: ChatContext): Promise<AIResponse> {
    const message = text.trim();
    // An answer to a pending question is always the rules' (chips, memory gating).
    const answering = !!ctx.answeringClarificationId || ctx.pendingClarifications.length > 0;
    const known = this.rules.understood(message, ctx);
    const several = namesSeveralProducts(message, ctx) || JOINED.test(message.toLowerCase());
    if (known && (answering || !several)) return noteReopen(known, ctx);

    const extraction = message ? await this.understand(message).catch(() => null) : null;
    if (extraction) {
      const answers = toCommands(extraction)
        .map((c) => this.rules.understood(c.text, ctx) ?? (c.add ? this.rules.unknownItem(c.text) : null))
        .filter((r): r is AIResponse => !!r);
      const merged = mergeResponses(answers);
      if (merged) return noteReopen(merged, ctx);
    }
    return known ? noteReopen(known, ctx) : this.rules.chat(message, ctx);
  }
}
