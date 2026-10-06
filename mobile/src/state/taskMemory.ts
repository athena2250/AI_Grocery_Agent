import { TASK_CATALOG } from '../data/taskCatalog';
import type { Section } from './tasks';

/**
 * Household memory for tasks: who usually does what. Written only when a task
 * is saved (a confirmed action, principle 7) and only ever *marks* a chip — the
 * person is never picked for her. Choosing someone else simply counts for them,
 * so the suggestion follows what the family actually does.
 */
export interface TaskPreference {
  /** Catalog id ("t_plumber"), or `section:<Section>` for tasks outside the catalog. */
  key: string;
  label: string;
  /** Times each member was chosen. */
  counts: Record<string, number>;
  lastWhoId: string;
  lastConfirmedAt: string;
}

/** Saved this many times with the same person before their chip is marked. */
export const SUGGEST_AFTER = 2;

export function memoryKey(d: { catalogId?: string; section: Section | null }): string | null {
  if (d.catalogId) return d.catalogId;
  return d.section ? `section:${d.section}` : null;
}

function labelFor(key: string): string {
  return TASK_CATALOG.find((e) => e.id === key)?.name ?? key.replace(/^section:/, '');
}

/** A saved task → memory. Tasks with nobody assigned teach nothing. */
export function learnTask(
  prefs: TaskPreference[],
  d: { catalogId?: string; section: Section | null; whoId: string | null },
  now: Date = new Date(),
): TaskPreference[] {
  const key = memoryKey(d);
  if (!key || !d.whoId) return prefs;
  const old = prefs.find((p) => p.key === key);
  const next: TaskPreference = {
    key,
    label: old?.label ?? labelFor(key),
    counts: { ...(old?.counts ?? {}), [d.whoId]: (old?.counts[d.whoId] ?? 0) + 1 },
    lastWhoId: d.whoId,
    lastConfirmedAt: now.toISOString(),
  };
  return old ? prefs.map((p) => (p.key === key ? next : p)) : [...prefs, next];
}

/**
 * Who to mark for this task: the member chosen most often, at least
 * SUGGEST_AFTER times, still in the home. A tie suggests nobody.
 */
export function suggestedWho(
  prefs: TaskPreference[],
  d: { catalogId?: string; section: Section | null },
  activeIds: string[],
): string | null {
  const key = memoryKey(d);
  const p = key ? prefs.find((x) => x.key === key) : undefined;
  return p ? usualFor(p, activeIds) : null;
}

/** The person one memory row points to, if it is sure enough. */
export function usualFor(p: TaskPreference, activeIds: string[]): string | null {
  const ranked = Object.entries(p.counts)
    .filter(([id]) => activeIds.includes(id))
    .sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] < SUGGEST_AFTER || (second && second[1] === top[1])) return null;
  return top[0];
}

export const forgetTaskPreference = (prefs: TaskPreference[], key: string) => prefs.filter((p) => p.key !== key);
