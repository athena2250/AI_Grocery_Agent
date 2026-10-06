/**
 * "Now" and new ids for the reducers. Normally the phone's clock and a counter;
 * while a shared event is being replayed (src/sync), they come from the event
 * itself — its time and its id — so every phone that replays the household's
 * log computes exactly the same list, pantry, tasks and members.
 */
let replay: { at: string; id: string; n: number } | null = null;
let counter = 0;

/** Run a reducer step as the event `id` that happened at `at`. */
export function withEvent<T>(at: string, id: string, fn: () => T): T {
  const prev = replay;
  replay = { at, id, n: 0 };
  try {
    return fn();
  } finally {
    replay = prev;
  }
}

export const clock = (): Date => (replay ? new Date(replay.at) : new Date());

export const uid = (prefix: string): string =>
  (replay ? `${prefix}_${replay.id}_${replay.n++}` : `${prefix}_${Date.now()}_${counter++}${Math.random().toString(36).slice(2, 6)}`);

/** A fresh, globally unique event id (not derived from a replay). */
export const eventId = (): string =>
  `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${(counter++).toString(36)}`;
