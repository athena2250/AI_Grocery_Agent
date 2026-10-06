import type { HouseholdState } from '../types';
import { identifyItem } from './identify';
import { identifyTask } from './identifyTask';
import { sectionFor } from './tasks';

/**
 * Type or speak, step 0: which parts of a message are groceries and which are
 * tasks? "get tomatoes and call the plumber tomorrow" → grocery "get tomatoes",
 * task "call the plumber tomorrow". Pure and rule-based, like the backend's
 * MULTI_SYSTEM_PROMPT split; the grocery text then goes through the grocery AI
 * unchanged, and each task part becomes a task draft.
 *
 * Order matters: a catalog task phrase ("milk bill") beats a grocery product
 * ("milk"), and a known grocery product beats a loose task keyword ("order rice"
 * is groceries, not Shopping). Anything unclear stays grocery, where the grocery
 * AI asks about it.
 */
export interface SplitMessage {
  grocery: string;
  tasks: string[];
}

const SPLIT_RE = /\s*(?:,|;|\n|\band then\b|\bthen\b|\balso\b|\band\b)\s*/i;

export function splitMessage(
  text: string,
  state: Pick<HouseholdState, 'products' | 'aliases' | 'aliasPreferences'>,
): SplitMessage {
  const parts = text.split(SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  const kinds = parts.map((part): 'task' | 'grocery' | 'unknown' => {
    if (identifyTask(part)?.candidates.length) return 'task';
    if (identifyItem(part, state)?.candidates.length) return 'grocery';
    if (sectionFor(part)) return 'task';
    return 'unknown';
  });
  const grocery: string[] = [];
  const tasks: string[] = [];
  parts.forEach((part, i) => {
    if (kinds[i] === 'task') { tasks.push(part); return; }
    // A short leftover next to a task ("tomorrow", "ask Dad") belongs to that task.
    if (kinds[i] === 'unknown' && part.split(/\s+/).length <= 3) {
      if (kinds[i - 1] === 'task') { tasks[tasks.length - 1] += ` ${part}`; return; }
      if (kinds[i + 1] === 'task') { parts[i + 1] = `${part} ${parts[i + 1]}`; return; }
    }
    grocery.push(part);
  });
  return { grocery: grocery.join(' and '), tasks };
}
