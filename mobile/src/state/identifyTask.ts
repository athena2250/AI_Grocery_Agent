import { TASK_CATALOG, type CatalogTask } from '../data/taskCatalog';
import { dueFor, sectionFor, tidyTitle, timeFor, whoFor, type Section } from './tasks';
import { KIND_FIELDS, kindOf, type TaskDraft } from './taskFields';

/**
 * + → Task, page 1: what did she type? A catalog lookup like `identifyItem`, no AI.
 *
 * "plumber" → Home Repair › Call the plumber; "ac" → AC repair or AC service
 * (asked, like coriander); "new mixer" → not in the catalog, with a keyword guess
 * for the section chip. A single match only pre-selects; a keyword guess is only
 * marked — she taps it.
 */
export interface TaskMatch {
  text: string;
  /** 1 = known task; >1 = ask which; 0 = not in the catalog. */
  candidates: CatalogTask[];
  /** Not in the catalog: the section the keywords point to, shown as a marked chip. */
  guess?: Section;
}

const norm = (s: string) => s.toLowerCase().replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasPhrase = (text: string, phrase: string) => new RegExp(`(?:^|\\s)${esc(phrase)}(?:\\s|$)`).test(text);

export function identifyTask(text: string, catalog: CatalogTask[] = TASK_CATALOG): TaskMatch | null {
  const t = norm(text);
  if (!t) return null;
  // The longest alias she said decides: "ac service" beats "ac", "gas bill" beats "gas".
  let best = 0;
  let hits: CatalogTask[] = [];
  for (const entry of catalog) {
    const len = Math.max(0, ...entry.aliases.filter((a) => hasPhrase(t, a)).map((a) => a.length));
    if (!len) continue;
    if (len > best) { best = len; hits = [entry]; } else if (len === best) hits.push(entry);
  }
  if (hits.length) return { text, candidates: hits };
  const guess = sectionFor(text);
  return { text, candidates: [], ...(guess ? { guess } : {}) };
}

/** Does this look like a task at all (vs. a grocery item)? Catalog or section keywords. */
export function looksLikeTask(text: string): boolean {
  const m = identifyTask(text);
  return !!m && (m.candidates.length > 0 || !!m.guess);
}

interface PersonRef { id: string; name: string; relation: string }

/**
 * Start a draft from her words: title, a catalog pick, and only the who / when /
 * time the words actually say. Anything else stays open for the details page.
 */
export function draftFromText(
  text: string,
  people: PersonRef[],
  meId: string,
  now: Date = new Date(),
  pick?: CatalogTask | null,
): TaskDraft {
  const match = identifyTask(text);
  const entry = pick ?? (match?.candidates.length === 1 ? match.candidates[0] : null);
  const section = entry?.section ?? null;
  const time = timeFor(text);
  const draft: TaskDraft = {
    title: tidyTitle(text),
    section,
    whoId: whoFor(text, people, meId),
    due: dueFor(text, now),
    details: {},
    notes: '',
    ...(entry ? { catalogId: entry.id } : {}),
  };
  return withCatalog(draft, entry, time);
}

/** Apply a catalog pick: its section and the fields its name implies; a said time goes where the kind keeps it. */
export function withCatalog(d: TaskDraft, entry: CatalogTask | null, time?: string): TaskDraft {
  const section = entry?.section ?? d.section;
  const kindKeys = new Set(KIND_FIELDS[kindOf({ section })].map((f) => f.key));
  const details = { ...d.details };
  for (const [k, v] of Object.entries(entry?.implied ?? {})) if (kindKeys.has(k)) details[k] = v;
  const next: TaskDraft = { ...d, section, details, ...(entry ? { catalogId: entry.id } : {}) };
  if (!time) return next;
  if (kindKeys.has('appointment_time')) return { ...next, details: { ...details, appointment_time: time } };
  if (typeof next.due === 'string' && !next.due.includes('T')) return { ...next, due: `${next.due}T${time}` };
  return { ...next, pendingTime: time };
}
