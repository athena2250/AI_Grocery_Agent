/**
 * Family tasks from + → Task: shapes, sections, date words, and how long a
 * task stays on the board. Pure — TasksContext owns storage. Nothing here
 * guesses (principle 2): a section, person or date the words don't say is left
 * missing and asked for. Section keywords mirror backend `feed/categorize.py`.
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

/** Backend `post_kind` for each section — decides which fields a task needs (see taskFields.ts). */
export type TaskKind = 'task' | 'bill' | 'appointment' | 'errand' | 'ticket_booking' | 'shopping' | 'misc';

export const SECTION_KIND: Record<Section, TaskKind> = {
  'Groceries': 'misc',
  'Home Repair': 'task',
  'Maintenance': 'task',
  'Household Chores': 'task',
  'Bills & Payments': 'bill',
  'Appointments': 'appointment',
  'Errands': 'errand',
  'Tickets': 'ticket_booking',
  'Shopping': 'shopping',
  'Discussions': 'misc',
  'Miscellaneous': 'misc',
};

export interface Task {
  id: string;
  /** "what" / "item" — her words. */
  title: string;
  section: Section;
  kind: TaskKind;
  notes: string;
  /** `assigned_to`; null only where the kind makes it optional (appointment, misc). */
  whoId: string | null;
  /** The kind's date field: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` with a deadline time, or null for "no rush". */
  due: string | null;
  /** Every other field, by backend field name (amount, bill_type, from, to …) — backend `task.details_json`. */
  details: Record<string, string>;
  /** Common-task catalog entry it was identified as, if any. */
  catalogId?: string;
  createdAt: string;
  createdBy: string;
  done: boolean;
  doneAt: string | null;
  /** Tasks saved before fields existed leave the board at this time. */
  legacyRetireAt?: string;
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

export function addDays(now: Date, n: number): string {
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

/**
 * A clock time the words say, as `HH:MM` — "5pm", "10:30 am", "17:00". A bare
 * "at 5" could be morning or evening, so it is not read (it gets asked).
 */
export function timeFor(text: string): string | undefined {
  const t = text.toLowerCase();
  const ampm = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] ?? 0);
    if (h < 1 || h > 12 || m > 59) return undefined;
    if (ampm[3].startsWith('p') && h !== 12) h += 12;
    if (ampm[3].startsWith('a') && h === 12) h = 0;
    return hhmm(h, m);
  }
  const h24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return h24 ? hhmm(Number(h24[1]), Number(h24[2])) : undefined;
}

export const hhmm = (h: number, m: number) => `${`${h}`.padStart(2, '0')}:${`${m}`.padStart(2, '0')}`;

/** A household member the words name ("ask Dad", "Priya will"), or "I/me" → whoever is typing. */
export function whoFor(text: string, people: PersonRef[], meId: string): string | null {
  const t = text.toLowerCase();
  const named = people.find((p) =>
    [p.name, p.relation].some((n) => n && new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)));
  if (named) return named.id;
  if (/\b(?:i will|i'll|i can|me|myself)\b/.test(t)) return meId;
  return null;
}

export function tidyTitle(text: string): string {
  const base = text.trim().split(/[.\n!?]/)[0].trim();
  return base ? base[0].toUpperCase() + base.slice(1) : '';
}

// ── Deadlines: a date, optionally with a time (like Apple Reminders) ──

export function splitDue(due: string): { date: string; time: string | null } {
  const [date, time] = due.split('T');
  return { date, time: time ?? null };
}

export const withTime = (date: string, time: string | null) => (time ? `${date}T${time}` : date);

const parseDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "17:30" → "5:30 pm". */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h12}:${`${m}`.padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Tomorrow · 5:30 pm", "Sat 10 Oct", "No rush". */
export function dueLabel(due: string | null | undefined, now: Date = new Date()): string {
  if (due === undefined) return '—';
  if (due === null) return 'No rush';
  const { date, time } = splitDue(due);
  let day: string;
  if (date === addDays(now, 0)) day = 'Today';
  else if (date === addDays(now, 1)) day = 'Tomorrow';
  else {
    const d = parseDate(date);
    const dow = DAYS[d.getDay()].slice(0, 3);
    const mon = d.toLocaleString('en-US', { month: 'short' });
    day = `${dow[0].toUpperCase()}${dow.slice(1)} ${d.getDate()} ${mon}`;
  }
  return time ? `${day} · ${timeLabel(time)}` : day;
}

/** True once the deadline has passed (a date-only deadline lasts the whole day). */
export function isOverdue(due: string | null, now: Date = new Date()): boolean {
  if (!due) return false;
  const { date, time } = splitDue(due);
  if (!time) return date < addDays(now, 0);
  const [h, m] = time.split(':').map(Number);
  const at = parseDate(date);
  at.setHours(h, m);
  return at.getTime() < now.getTime();
}

/** Quick answers for "By when?". `noRush` only where the date is allowed to be open. */
export function dueChoices(now: Date = new Date(), noRush = true): { label: string; due: string | null }[] {
  return [
    { label: 'Today', due: addDays(now, 0) },
    { label: 'Tomorrow', due: addDays(now, 1) },
    { label: 'This weekend', due: addDays(now, daysUntil(now, 6)) },
    { label: 'Next week', due: addDays(now, daysUntil(now, 1) || 7) },
    ...(noRush ? [{ label: 'No rush', due: null }] : []),
  ];
}

/** A month for the calendar: weeks of 7 cells, Sunday first, `null` outside the month. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(first).fill(null),
    ...Array.from({ length: days }, (_, i) => isoDate(new Date(year, month, i + 1))),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ── How long a task stays on the board ──

/** A finished task is shown to the family this long, then moves to Task history. */
export const KEEP_ON_BOARD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ArchivedTask extends Task {
  archivedAt: string;
  /** Why it left the board: finished 3 days ago, or saved before task fields existed. */
  reason: 'done' | 'legacy';
}

/** When the task leaves the board, or null while it is still open. */
export function retiresAt(t: Task): { at: string; reason: ArchivedTask['reason'] } | null {
  const done = t.done && t.doneAt ? new Date(new Date(t.doneAt).getTime() + KEEP_ON_BOARD_DAYS * DAY_MS).toISOString() : null;
  if (t.legacyRetireAt && (!done || t.legacyRetireAt <= done)) return { at: t.legacyRetireAt, reason: 'legacy' };
  return done ? { at: done, reason: 'done' } : null;
}

/** Calendar days until it leaves the board (0 = today), or null while open. */
export function daysLeftOnBoard(t: Task, now: Date = new Date()): number | null {
  const r = retiresAt(t);
  if (!r) return null;
  const at = new Date(r.at);
  const days = (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
    - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY_MS;
  return Math.max(0, Math.round(days));
}

/** Split the board into what stays and what moves to Task history now. */
export function sweepTasks(tasks: Task[], now: Date = new Date()): { active: Task[]; archived: ArchivedTask[] } {
  const active: Task[] = [];
  const archived: ArchivedTask[] = [];
  for (const t of tasks) {
    const r = retiresAt(t);
    if (r && new Date(r.at).getTime() <= now.getTime()) archived.push({ ...t, archivedAt: now.toISOString(), reason: r.reason });
    else active.push(t);
  }
  return { active, archived };
}

/**
 * Bring a stored task up to today's shape. v1 tasks (before fields) have no
 * `kind`: they keep showing for KEEP_ON_BOARD_DAYS from the upgrade, then go to history.
 */
export function migrateTask(raw: any, now: Date = new Date()): Task {
  const legacy = !raw.kind;
  const section: Section = SECTIONS.includes(raw.section) ? raw.section : 'Miscellaneous';
  return {
    ...raw,
    section,
    kind: raw.kind ?? SECTION_KIND[section],
    notes: raw.notes ?? '',
    whoId: raw.whoId ?? null,
    due: raw.due ?? null,
    details: raw.details ?? {},
    done: !!raw.done,
    doneAt: raw.doneAt ?? (raw.done ? now.toISOString() : null),
    ...(legacy ? { legacyRetireAt: new Date(now.getTime() + KEEP_ON_BOARD_DAYS * DAY_MS).toISOString() } : {}),
  };
}
