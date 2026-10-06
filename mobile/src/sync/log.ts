import { withEvent } from '../state/eventClock';

/**
 * Family sharing, the pure part. Each phone keeps, per stream (grocery, tasks,
 * profile):
 * - `confirmed` — the household's state after every event the server has
 *   ordered, up to `lastSeq`;
 * - `pending` — this phone's own events not yet confirmed.
 * What the screens show is `confirmed` with `pending` replayed on top. When the
 * server's events arrive they are folded into `confirmed` in server order and
 * any of ours among them leave `pending`; because the reducers take time and
 * ids from the event (eventClock), every phone computes the same thing.
 */
export interface Envelope<A> {
  id: string;
  /** ISO, millisecond precision — the replay's "now". */
  at: string;
  body: A;
}

export interface RemoteEvent<A> extends Envelope<A> {
  seq: number;
  /** Member id of the sender. */
  by?: string | null;
}

export interface StreamCache<S, A> {
  /** Whose household this cache belongs to; a different sign-in starts afresh. */
  householdId: string;
  confirmed: S;
  lastSeq: number;
  pending: Envelope<A>[];
}

export type Reduce<S, A> = (state: S, action: A) => S;

export const applyEnvelope = <S, A>(reduce: Reduce<S, A>, state: S, e: Envelope<A>): S =>
  withEvent(e.at, e.id, () => reduce(state, e.body));

export const viewOf = <S, A>(reduce: Reduce<S, A>, cache: Pick<StreamCache<S, A>, 'confirmed' | 'pending'>): S =>
  cache.pending.reduce((s, e) => applyEnvelope(reduce, s, e), cache.confirmed);

/** Fold the server's events (in seq order) into `confirmed`; ours among them stop being pending. */
export function foldRemote<S, A>(reduce: Reduce<S, A>, cache: StreamCache<S, A>, events: RemoteEvent<A>[]): StreamCache<S, A> {
  const fresh = events.filter((e) => e.seq > cache.lastSeq).sort((a, b) => a.seq - b.seq);
  if (!fresh.length) return cache;
  const seen = new Set(fresh.map((e) => e.id));
  return {
    ...cache,
    confirmed: fresh.reduce((s, e) => applyEnvelope(reduce, s, e), cache.confirmed),
    lastSeq: fresh[fresh.length - 1].seq,
    pending: cache.pending.filter((e) => !seen.has(e.id)),
  };
}

/** A new home's log starts from what this phone already had (its data from before signing in). */
export function seededCache<S, A>(householdId: string, initial: S, seed: S | null, hydrate: (s: S) => A, makeEnvelope: (a: A) => Envelope<A>): StreamCache<S, A> {
  return { householdId, confirmed: initial, lastSeq: 0, pending: seed ? [makeEnvelope(hydrate(seed))] : [] };
}
