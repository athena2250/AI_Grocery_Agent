import { SECTION_KIND, withTime, type Section, type Task, type TaskKind } from './tasks';

/**
 * What each kind of task needs before it can be saved — a copy of the backend
 * `POST_KIND_FIELDS` (app/seed.py): same field names, labels, questions and
 * required flags, so the phone asks exactly what the server will check.
 * Pure; the details page and Type or speak both render from this.
 *
 * Where a field lives on the Task: `what` / `item` → title, `assigned_to` →
 * whoId, the kind's date field → due, everything else → details[field].
 */

export type FieldType = 'text' | 'member' | 'members' | 'date' | 'time' | 'money' | 'choice';

export interface FieldSpec {
  key: string;
  label: string;
  question: string;
  required: boolean;
  type: FieldType;
  /** Quick answers (bill type, mode …). */
  chips?: string[];
  /** Date fields: "No rush" counts as an answer. */
  noRush?: boolean;
}

const f = (key: string, label: string, required: boolean, type: FieldType, question: string, extra: Partial<FieldSpec> = {}): FieldSpec =>
  ({ key, label, required, type, question, ...extra });

export const KIND_FIELDS: Record<TaskKind, FieldSpec[]> = {
  task: [
    f('what', 'What needs doing', true, 'text', 'What exactly needs to be done?'),
    f('assigned_to', 'Who should do it', true, 'member', 'Who should take care of it?'),
    f('needed_by', 'Needed by', true, 'date', 'By when does it need to be done?', { noRush: true }),
    f('location_in_house', 'Where in the house', false, 'text', 'Where in the house?'),
    f('budget', 'Budget', false, 'money', 'Any budget in mind?'),
  ],
  ticket_booking: [
    f('from', 'From', true, 'text', 'Travelling from where?'),
    f('to', 'To', true, 'text', 'Travelling to where?'),
    f('travel_date', 'Travel date', true, 'date', 'Which date?'),
    f('passengers', 'Passengers', true, 'members', 'Who is travelling?'),
    f('assigned_to', 'Who books it', true, 'member', 'Who should book the tickets?'),
    f('mode', 'Mode / class', false, 'choice', 'Train, bus or flight? Which class?', { chips: ['Train', 'Bus', 'Flight'] }),
    f('time_pref', 'Time preference', false, 'choice', 'Any preferred time?', { chips: ['Morning', 'Afternoon', 'Night'] }),
  ],
  bill: [
    f('bill_type', 'Bill', true, 'choice', 'Which bill is it?', { chips: ['Electricity', 'Internet', 'Maintenance', 'Water', 'Gas', 'Phone'] }),
    f('amount', 'Amount', true, 'money', 'How much is the bill?'),
    f('due_date', 'Due date', true, 'date', 'When is it due?'),
    f('assigned_to', 'Who pays', true, 'member', 'Who should pay it?'),
    f('account_ref', 'Account / consumer no.', false, 'text', 'Account or consumer number?'),
  ],
  appointment: [
    f('what', 'Appointment', true, 'text', 'What is the appointment for?'),
    f('appointment_date', 'Date', true, 'date', 'Which day is it?'),
    f('appointment_time', 'Time', true, 'time', 'What time is it?', { chips: ['Morning', 'Afternoon', 'Evening'] }),
    f('for_member', 'For', false, 'member', 'Who is the appointment for?'),
    f('assigned_to', 'Who goes along', false, 'member', 'Who is taking them?'),
    f('location', 'Where', false, 'text', 'Where is it?'),
  ],
  errand: [
    f('what', 'Errand', true, 'text', 'What needs to be done?'),
    f('assigned_to', 'Who does it', true, 'member', 'Who should do it?'),
    f('needed_by', 'Needed by', true, 'date', 'When would you like to do this?', { noRush: true }),
    f('location', 'Where', false, 'text', 'Where do they need to go?'),
  ],
  shopping: [
    f('item', 'Item', true, 'text', 'What should we buy?'),
    f('assigned_to', 'Who buys it', true, 'member', 'Who should buy it?'),
    f('needed_by', 'Needed by', false, 'date', 'When do you need it?', { noRush: true }),
    f('budget', 'Budget', false, 'money', 'Any budget in mind?'),
  ],
  misc: [
    f('what', 'What', true, 'text', 'What should I note down?'),
    f('assigned_to', 'Who', false, 'member', 'Is this for someone in particular?'),
    f('needed_by', 'When', false, 'date', 'Is there a date for this?', { noRush: true }),
  ],
};

/** Backend `feed/questions.py` FIELD_RANK: what it is before when, when before who, who before how much. */
const FIELD_RANK: Record<string, number> = {
  item: 1, what: 1, bill_type: 1,
  from: 2, to: 2,
  needed_by: 3, due_date: 3, appointment_date: 3, travel_date: 3,
  appointment_time: 4,
  amount: 5, passengers: 5,
  assigned_to: 6,
};

/** A task being filled in, before Save. `due: undefined` = not answered; `null` = "no rush". */
export interface TaskDraft {
  title: string;
  section: Section | null;
  whoId: string | null;
  due: string | null | undefined;
  details: Record<string, string>;
  notes: string;
  catalogId?: string;
  /** A time she said ("at 5pm") before a date was picked — joins the date once there is one. */
  pendingTime?: string;
}

export const kindOf = (d: Pick<TaskDraft, 'section'>): TaskKind => SECTION_KIND[d.section ?? 'Miscellaneous'];
export const fieldsFor = (d: Pick<TaskDraft, 'section'>) => KIND_FIELDS[kindOf(d)];
const isTitle = (key: string) => key === 'what' || key === 'item';

export function isAnswered(d: TaskDraft, field: FieldSpec): boolean {
  if (isTitle(field.key)) return !!d.title.trim();
  if (field.key === 'assigned_to') return !!d.whoId;
  if (field.type === 'date') return d.due !== undefined;
  return !!d.details[field.key]?.trim();
}

/** Required fields still open, in the order Hearth asks them. No section yet → only that is missing. */
export function missingFields(d: TaskDraft): FieldSpec[] {
  if (!d.section) return [];
  return fieldsFor(d)
    .filter((fl) => fl.required && !isAnswered(d, fl))
    .sort((a, b) => (FIELD_RANK[a.key] ?? 50) - (FIELD_RANK[b.key] ?? 50));
}

export const isComplete = (d: TaskDraft) => !!d.section && missingFields(d).length === 0;

/** Short words for the "Still need: …" button. */
export function missingLabels(d: TaskDraft): string[] {
  if (!d.section) return ['which kind'];
  return missingFields(d).map((fl) => fl.label.toLowerCase());
}

/** The one question to ask next (Type or speak asks one thing at a time). */
export const nextQuestion = (d: TaskDraft): FieldSpec | null => (d.section ? missingFields(d)[0] ?? null : null);

/**
 * Set one field from an answer; `undefined` clears it. A time she said in words
 * ("at 5pm") joins the first date picked.
 */
export function answer(d: TaskDraft, field: FieldSpec, value: string | null | undefined): TaskDraft {
  if (isTitle(field.key)) return { ...d, title: value ?? '' };
  if (field.key === 'assigned_to') return { ...d, whoId: value ?? null };
  if (field.type === 'date') {
    if (value === undefined) return { ...d, due: undefined };
    if (value === null) return { ...d, due: null, pendingTime: undefined };
    // The picker always sends the whole deadline; only a time said in words is merged in.
    const time = value.includes('T') || field.key === 'appointment_date' ? null : d.pendingTime ?? null;
    return { ...d, due: withTime(value, time), pendingTime: undefined };
  }
  const details = { ...d.details };
  if (value == null || !value.trim()) delete details[field.key];
  else details[field.key] = value;
  return { ...d, details };
}

/** The value a field shows: title / member id / due / details. */
export function valueOf(d: TaskDraft, field: FieldSpec): string | null | undefined {
  if (isTitle(field.key)) return d.title;
  if (field.key === 'assigned_to') return d.whoId;
  if (field.type === 'date') return d.due;
  return d.details[field.key];
}

/** Switching section re-sorts the fields; keep what still fits, drop extras the new kind doesn't have. */
export function withSection(d: TaskDraft, section: Section): TaskDraft {
  const keys = new Set(KIND_FIELDS[SECTION_KIND[section]].map((fl) => fl.key));
  const details = Object.fromEntries(Object.entries(d.details).filter(([k]) => keys.has(k)));
  // A time she said waits for a date — except an appointment keeps it as its own field.
  if (d.pendingTime && keys.has('appointment_time') && !details.appointment_time) {
    return { ...d, section, details: { ...details, appointment_time: d.pendingTime }, pendingTime: undefined };
  }
  return { ...d, section, details };
}

/** A finished draft → the fields TasksContext stores. Optional dates left open save as "no rush". */
export function draftToTask(d: TaskDraft): Omit<Task, 'id' | 'createdAt' | 'createdBy' | 'done' | 'doneAt'> | null {
  if (!isComplete(d)) return null;
  const section = d.section!;
  return {
    title: d.title.trim(),
    section,
    kind: SECTION_KIND[section],
    notes: d.notes.trim(),
    whoId: d.whoId,
    due: d.due ?? null,
    details: d.details,
    ...(d.catalogId ? { catalogId: d.catalogId } : {}),
  };
}

/** One line of a task's extra details for list rows: "₹1,200 · Electricity". */
export function detailsLine(t: Pick<Task, 'kind' | 'details'>, memberName: (id: string) => string | undefined): string {
  return KIND_FIELDS[t.kind]
    .filter((fl) => t.details[fl.key])
    .map((fl) => {
      const v = t.details[fl.key];
      if (fl.type === 'money') return `₹${Number(v).toLocaleString('en-IN')}`;
      if (fl.type === 'member') return `${fl.label}: ${memberName(v) ?? v}`;
      if (fl.key === 'from') return `${v} →`;
      return v;
    })
    .join(' · ');
}
