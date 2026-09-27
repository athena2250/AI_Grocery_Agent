import type { InventoryState } from '../types';

/**
 * Inventory phrase parser for the mock AI (plan_06). Maps how the house talks
 * about the pantry — English, Hindi and Telugu, romanized — to a coarse state,
 * plus an approximate amount when one was said. In Phase 2 the LLM does this
 * step; the phrase list lives on in backend/app/understanding/prompts.py.
 *
 * Rules are checked in order and the first hit wins, so the more specific
 * phrase sits above the general one ("khatam hone wala" before "khatam",
 * "running out" before "out of", "not enough" before "enough").
 */
export interface InventoryPhrase {
  state: InventoryState;
  approxQty?: number;
  approxUnit?: string;
}

const RULES: [InventoryState, RegExp][] = [
  ['almost_finished', /\b(almost|nearly) (finished|done|over|gone|empty|khatam)\b/],
  ['almost_finished', /\babout to (finish|run out|get over)\b/],
  ['almost_finished', /\bkhatam (hone|hone ko) (wala|wali|vala|vali|hai)\b/],
  // Telugu: "aipovachindi" / "aipothundi" — about to run out.
  ['almost_finished', /\b(aipovachindi|ayipovachindi|aipovachhindi|aipothundi|ayipothundi|aipotundi|aipotondi)\b/],
  // Telugu: "konchem e undi" — only a little is left.
  ['almost_finished', /\b(konchem|koncham) ?(e|ey|ee) undi\b|\b(konchemey|konchame|konchemee) undi\b/],
  ['almost_finished', /\b(only|just)\b.*\bleft\b|\bthoda (hi|sa) bacha\b/],
  ['almost_finished', /\blast (packet|pack|bottle|bit)\b/],

  ['running_low', /\brunning (low|out)\b/],
  ['running_low', /\blow\b/],
  ['running_low', /\bnot (much|enough)\b|\bdon'?t have enough\b/],
  ['running_low', /\bkam (hai|ho gaya|ho gayi|ho raha|ho rahi)\b/],
  // Telugu: "takkuva undi" — it's low; "saripodu / saripoledu" — won't be enough.
  ['running_low', /\b(takkuva|thakkuva)\b|\b(saripodu|saripoledu|saripovu)\b/],

  ['out', /\b(no|none|nothing|zero)\b.*\bleft\b/],
  ['out', /\b(out of|ran out|run out|finished|over|empty|khatam|gone)\b/],
  ['out', /\bdon'?t have (any)?\b|\bnahi hai\b/],
  // Telugu: "aipoyindi" — it's finished; "ledu" — there isn't any.
  ['out', /\b(aipoyindi|ayipoyindi|aipoindi|ayipoindi|ledu)\b/],

  ['available', /\b(plenty|enough|lots of|lot of|full|stocked|available)\b|\bstill (have|got|there)\b/],
  ['available', /\b(bahut|kaafi|kafi) hai\b/],
  // Telugu: "chala undi" — plenty; "inka undi" — still some; "saripada undi" — enough.
  ['available', /\b(chala|chaala|bola|inka|saripada) undi\b/],
];

const UNITS: Record<string, string> = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml', l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L',
  pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack',
  bottle: 'bottle', bottles: 'bottle', bunch: 'bunch', dozen: 'dozen', pcs: 'pcs',
};
const UNIT_RE = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|');
const AMOUNT_RE = new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?|½|1/2|half|one|a|an)\\s*(?:a\\s+)?(${UNIT_RE})\\b`);
const WORD_QTY: Record<string, number> = { '½': 0.5, '1/2': 0.5, half: 0.5, one: 1, a: 1, an: 1 };

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[?!,]|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();

/** "half a packet", "about 200 g", "1 bottle" → { qty, unit }. */
export function parseApproxQty(text: string): { approxQty: number; approxUnit: string } | null {
  const m = norm(text).match(AMOUNT_RE);
  if (!m) return null;
  const approxQty = WORD_QTY[m[1]] ?? parseFloat(m[1]);
  return { approxQty, approxUnit: UNITS[m[2]] };
}

/** The pantry state a message states, or null if it isn't an inventory statement. */
export function parseInventoryPhrase(text: string): InventoryPhrase | null {
  const t = norm(text);
  const hit = RULES.find(([, re]) => re.test(t));
  if (!hit) return null;
  const state = hit[0];
  // An amount means something on hand; "out" has none by definition.
  const amount = state === 'out' ? null : parseApproxQty(t);
  return amount ? { state, ...amount } : { state };
}
