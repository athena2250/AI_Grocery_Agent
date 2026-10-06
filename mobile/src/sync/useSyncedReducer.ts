import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../state/AuthContext';
import { eventId } from '../state/eventClock';
import { ApiError, api, isOnline } from '../services/api';
import { foldRemote, seededCache, viewOf, type Envelope, type Reduce, type RemoteEvent, type StreamCache } from './log';

export type Stream = 'grocery' | 'tasks' | 'profile';

const POLL_MS = 15_000;
const PUSH_BATCH = 100;

interface Options<S, A> {
  stream: Stream;
  reducer: Reduce<S, A>;
  initial: S;
  /** The action that replaces the whole state (a new home's first event). */
  hydrate: (s: S) => A;
  /** This phone's own copy — the sandbox store, and what a new home starts from. */
  loadLocal: () => Promise<S | null>;
  saveLocal: (s: S) => void;
}

const cacheKey = (stream: Stream) => `hearth_sync_${stream}_v1`;

/**
 * A reducer whose state is shared by the family (see ./log). Sandbox mode, or
 * signed out: plain local state, saved on this phone, exactly as before. Signed
 * in to the server: every action becomes an event in the household's log —
 * shown at once, sent in the background, and replayed in server order with
 * everyone else's. Works offline: unsent events wait and go when it can.
 */
export function useSyncedReducer<S, A>(o: Options<S, A>) {
  const { account, token, newHome, sessionEnded } = useAuth();
  const householdId = isOnline() && token ? account?.householdId ?? null : null;
  const opts = useRef(o);
  useEffect(() => { opts.current = o; });

  // ---- sandbox / signed out
  const [local, setLocal] = useState<S>(o.initial);
  const [localReady, setLocalReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    opts.current.loadLocal().then((s) => {
      if (!mounted) return;
      if (s) setLocal(s);
      setLocalReady(true);
    });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (localReady && !householdId) opts.current.saveLocal(local);
  }, [local, localReady, householdId]);

  // ---- server
  const [cache, setCacheState] = useState<StreamCache<S, A> | null>(null);
  const cacheRef = useRef<StreamCache<S, A> | null>(null);
  const [ready, setReady] = useState(false);
  const setCache = useCallback((next: StreamCache<S, A> | null) => {
    cacheRef.current = next;
    setCacheState(next);
  }, []);

  // One send-and-catch-up at a time; a call while one runs asks it for another round and
  // shares its promise. Resolves true when nothing of ours is left unsent.
  const inflight = useRef<Promise<boolean> | null>(null);
  const again = useRef(false);
  const flush = useCallback((): Promise<boolean> => {
    if (!householdId || !token) return Promise.resolve(false);
    if (inflight.current) { again.current = true; return inflight.current; }
    const { stream, reducer } = opts.current;
    const run = async () => {
      try {
        do {
          again.current = false;
          const pending = cacheRef.current?.pending ?? [];
          for (let i = 0; i < pending.length; i += PUSH_BATCH) {
            await api(`/sync/${stream}`, { body: { events: pending.slice(i, i + PUSH_BATCH) }, token });
          }
          let more = true;
          while (more && cacheRef.current?.householdId === householdId) {
            const r = await api<{ events: RemoteEvent<A>[]; more: boolean }>(
              `/sync/${stream}?after=${cacheRef.current.lastSeq}`, { token },
            );
            if (r.events.length) setCache(foldRemote(reducer, cacheRef.current, r.events));
            more = r.more;
          }
        } while (again.current);
        return (cacheRef.current?.pending.length ?? 0) === 0;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) sessionEnded(e.message);
        // No connection: unsent events stay pending; the next poll retries.
        return false;
      } finally {
        inflight.current = null;
      }
    };
    inflight.current = run();
    return inflight.current;
  }, [householdId, token, setCache, sessionEnded]);

  // Load (or start) this home's cache, then catch up with the server.
  useEffect(() => {
    if (!householdId || !localReady) return;
    let mounted = true;
    (async () => {
      const { stream, initial, hydrate } = opts.current;
      let saved: StreamCache<S, A> | null = null;
      try {
        const raw = await AsyncStorage.getItem(cacheKey(stream));
        saved = raw ? JSON.parse(raw) : null;
      } catch {
        saved = null;
      }
      if (!mounted) return;
      const fresh = saved?.householdId !== householdId;
      const start = !fresh ? saved! : seededCache<S, A>(
        householdId, initial, newHome ? local : null, hydrate,
        (body) => ({ id: eventId(), at: new Date().toISOString(), body }),
      );
      setCache(start);
      if (!fresh) setReady(true); // show what we had; the catch-up runs behind it
      await flush();
      if (mounted) setReady(true);
    })();
    // Leaving this home (sign-out, another account): drop its cache from memory.
    return () => { mounted = false; setCache(null); setReady(false); };
    // `local`/`newHome` are read once, when the home's cache is first made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, localReady]);

  useEffect(() => {
    if (!cache) return;
    const t = setTimeout(() => {
      AsyncStorage.setItem(cacheKey(opts.current.stream), JSON.stringify(cache)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [cache]);

  useEffect(() => {
    if (!householdId) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') flush(); }, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') flush(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [householdId, flush]);

  const shared = useMemo(() => (cache ? viewOf(o.reducer, cache) : null), [cache, o.reducer]);

  // Stable for the life of the provider (callers memoize on it), so it reads the mode from refs.
  const live = useRef({ householdId, flush });
  useEffect(() => { live.current = { householdId, flush }; }, [householdId, flush]);
  const dispatch = useCallback((action: A) => {
    const current = cacheRef.current;
    if (live.current.householdId && current) {
      const e: Envelope<A> = { id: eventId(), at: new Date().toISOString(), body: action };
      setCache({ ...current, pending: [...current.pending, e] });
      setTimeout(() => live.current.flush(), 0);
    } else {
      setLocal((s) => opts.current.reducer(s, action));
    }
  }, [setCache]);

  /** Forget this phone's copy of the home (signing out / deleting the account). */
  const clearShared = useCallback(async () => {
    setCache(null);
    await AsyncStorage.removeItem(cacheKey(opts.current.stream)).catch(() => {});
  }, [setCache]);

  /** Send what's waiting now (before an action that ends the session). */
  const flushNow = useCallback(() => live.current.flush(), []);

  return {
    state: householdId ? (shared ?? o.initial) : local,
    dispatch,
    flushNow,
    hydrated: householdId ? ready && !!shared : localReady,
    shared: !!householdId,
    clearShared,
  };
}
