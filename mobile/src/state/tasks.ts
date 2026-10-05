/**
 * Family tasks from the + sheet: shapes, sections, and the sandbox "Hearth AI"
 * fill. Pure — TasksContext owns storage. The fill only reads what was typed
 * (principle 2): a section, person or date it can't find is left missing and
 * asked for, never guessed. Section keywords mirror backend `feed/categorize.py`.
 */

export const SECTIONS = [
  'Groceries',
  'Home Repair',
  'Maintenance',
  'Household Chores',
  'Bills & Payments',
  'Appointments',
  'Errands',
  'Tickets',
  'Shopping',
  'Discussions',
  'Miscellaneous',
] as const;
export type Section = (typeof SECTIONS)[number];

export interface Task {
  id: string;
  title: string;
  section: Section;
  notes: string;
  /** Member who does it. */
  whoId: string;
  /** `YYYY-MM-DD`, or null when the author said "no rush". */
  due: string | null;
  createdAt: string;
  createdBy: string;
  done: boolean;
}

export type MissingField = 'title' | 'section' | 'who' | 'due';

/** What the fill produced. `due: undefined` = not found yet; `null` = "no rush" (an answer). */
export interface TaskDraft {
  title: string;
  section: Section | null;
  /** True when the section came from the words, not the author's pick. */
  sectionFromAI: boolean;
  notes: string;
  whoId: string | null;
  due: string | null | undefined;
  missing: MissingField[];
}

interface PersonRef { id: string; name: string; relation: string }

const words = (...w: string[]) => new RegExp(`\\b(?:${w.join('|')})\\b`, 'i');

/** First match wins — same order as the backend rules. */
const SECTION_RULES: [Section, RegExp][] = [
  ['Bills & Payments', words('bills?', 'eb', 'emi', 'recharge', 'premium', 'dues', 'current bill', 'pay (?:the )?(?:electricity|internet|wifi|water|gas|phone|rent|maintenance|school fees?|fees)')],
  ['Tickets', words('tickets?', 'tatkal', 'book (?:a |the )?(?:train|bus|flight|cab)')],
  ['Appointments', words('appointments?', 'doctor', 'dr', 'dentist', 'check ?-?up', 'clinic', 'hospital', 'vaccination', 'ptm')],
  ['Errands', words('bank', 'cheque', 'atm', 'post office', 'courier', 'parcel', 'pick ?up', 'drop (?:off)?', 'collect', 'passport', 'aadhaa?r', 'xerox', 'photocopy', 'dry clean(?:ing)?')],
  ['Maintenance', words('service', 'serviced', 'servicing', 'pest control', 'tank cleaning', 'ro filter', 'filter change', 'paint(?:ing)?')],
  ['Home Repair', words('leak', 'leaking', 'leaks', 'tap', 'plumb(?:er|ing)?', 'pipe', 'repair', 'fix', 'broken', 'not working', 'electrician', 'fuse', 'switch', 'wiring', 'carpenter', 'lock', 'geyser', 'ac', 'fridge', 'fan', 'light', 'bulb', 'tube ?light')],
  ['Household Chores', words('clean', 'wash', 'laundry', 'iron', 'ironing', 'sweep', 'mop', 'dishes', 'water the plants', 'garbage', 'trash', 'dusting')],
  ['Discussions', words('discuss', 'talk about', 'decide', 'plan for', 'family meeting')],
  ['Shopping', words('buy', 'order', 'purchase', 'get a new')],
];

export function sectionFor(text: string): Section | null {
  return SECTION_RULES.find(([, re]) => re.test(text))?.[0] ?? null;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(now: Date, n: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  return isoDate(d);
}

/** Days until the next `weekday` (0 = Sunday), today counting as 0. */
function daysUntil(now: Date, weekday: number): number {
  return (weekday - now.getDay() + 7) % 7;
}

/** A due date the words actually say, or undefined. "No rush" → null. */
export function dueFor(text: string, now: Date): string | null | undefined {
  const t = text.toLowerCase();
  if (/\b(?:no rush|whenever|anytime|any time)\b/.test(t)) return null;
  if (/\bday after tomorrow\b/.test(t)) return addDays(now, 2);
  if (/\b(?:tomorrow|tmrw|tmr)\b/.test(t)) return addDays(now, 1);
  if (/\b(?:today|tonight|now|asap|urgent(?:ly)?)\b/.test(t)) return addDays(now, 0);
  if (/\b(?:this )?weekend\b/.test(t)) return addDays(now, daysUntil(now, 6));
  if (/\bnext week\b/.test(t)) return addDays(now, daysUntil(now, 1) || 7);
  const day = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (day >= 0) return addDays(now, daysUntil(now, day));
  return undefined;
}

/** A household member the words name ("ask Dad", "Priya will"), or "I/me" → whoever is typing. */
export function whoFor(text: string, people: PersonRef[], meId: string): string | null {
  const t = text.toLowerCase();
  const named = people.find((p) =>
    [p.name, p.relation].some((n) => n && new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)));
  if (named) return named.id;
  if (/\b(?:i will|i'll|i can|me|myself)\b/.test(t)) return meId;
  return null;
}

function tidyTitle(title: string, info: string): string {
  const base = title.trim() || info.trim().split(/[.\n!?]/)[0].trim();
  return base ? base[0].toUpperCase() + base.slice(1) : '';
}

/** The sandbox "Fill with Hearth AI". An explicit pick of section always beats the keywords (principle 7). */
export function fillTask(
  input: { title: string; section: Section | null; info: string },
  people: PersonRef[],
  meId: string,
  now: Date = new Date(),
): TaskDraft {
  const text = `${input.title} ${input.info}`;
  const guessed = input.section ? null : sectionFor(text);
  const draft: TaskDraft = {
    title: tidyTitle(input.title, input.info),
    section: input.section ?? guessed,
    sectionFromAI: !input.section && !!guessed,
    notes: input.info.trim(),
    whoId: whoFor(text, people, meId),
    due: dueFor(text, now),
    missing: [],
  };
  return withMissing(draft);
}

/** Recompute what's still needed after an answer. */
export function withMissing(d: TaskDraft): TaskDraft {
  const missing: MissingField[] = [];
  if (!d.title) missing.push('title');
  if (!d.section) missing.push('section');
  if (!d.whoId) missing.push('who');
  if (d.due === undefined) missing.push('due');
  return { ...d, missing };
}

/** "Today", "Tomorrow", "Sat 10 Oct", "No rush". */
export function dueLabel(due: string | null | undefined, now: Date = new Date()): string {
  if (due === undefined) return '—';
  if (due === null) return 'No rush';
  if (due === addDays(now, 0)) return 'Today';
  if (due === addDays(now, 1)) return 'Tomorrow';
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = DAYS[date.getDay()].slice(0, 3);
  const mon = date.toLocaleString('en-US', { month: 'short' });
  return `${dow[0].toUpperCase()}${dow.slice(1)} ${d} ${mon}`;
}

/** Quick answers for "By when?". */
export function dueChoices(now: Date = new Date()): { label: string; due: string | null }[] {
  return [
    { label: 'Today', due: addDays(now, 0) },
    { label: 'Tomorrow', due: addDays(now, 1) },
    { label: 'This weekend', due: addDays(now, daysUntil(now, 6)) },
    { label: 'No rush', due: null },
  ];
}
