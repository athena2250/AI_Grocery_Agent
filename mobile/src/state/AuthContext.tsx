import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { Account } from './auth';
import { isOnline, setSessionToken } from '../services/api';
import { checkSession } from '../services/HttpAuthService';
import { getAuthService } from '../services/serviceFactory';

/**
 * Who is signed in on this phone. The AuthScreen talks to AuthService and
 * hands the verified account here; signing out keeps the home's data.
 *
 * Server mode adds the session token (kept in the phone's secure store, not
 * AsyncStorage) and re-checks it on launch: signed in on another phone or
 * taken out of the home → back to the sign-in screen with the reason.
 */
const KEY = 'hearth_session_v1';
const TOKEN_KEY = 'hearth_token_v1';

interface Session {
  account: Account;
  signedInAt: string;
  /** This sign-in started a new home: the phone's data so far seeds the family's (src/sync). */
  newHome?: boolean;
}

interface Ctx {
  account: Account | null;
  /** Server mode only. */
  token: string | null;
  newHome: boolean;
  hydrated: boolean;
  /** Why the last session ended without the person asking (shown on the sign-in screen). */
  endedBecause: string | null;
  signIn: (account: Account, opts?: { token?: string; created?: boolean }) => void;
  signOut: () => Promise<void>;
  /** The server said this session is over (401). */
  sessionEnded: (why: string) => void;
}

const AuthCtx = createContext<Ctx | null>(null);

const isAccount = (a: any): a is Account =>
  !!a && typeof a.phone === 'string' && typeof a.name === 'string' && typeof a.relation === 'string';

const tokenStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
  set: (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t).catch(() => {}),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [endedBecause, setEndedBecause] = useState<string | null>(null);

  const forget = useCallback(async (why: string | null) => {
    setSession(null);
    setToken(null);
    setEndedBecause(why);
    await Promise.all([AsyncStorage.removeItem(KEY).catch(() => {}), tokenStore.clear()]);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      let restored: Session | null = null;
      let saved: string | null = null;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (isAccount(parsed?.account)) restored = parsed;
        if (isOnline()) saved = await tokenStore.get();
      } catch {
        // signed out
      }
      // A sandbox session (no server account) can't talk to the server: sign in again.
      if (isOnline() && (!saved || !restored?.account.householdId)) restored = null;
      if (!mounted) return;
      setSession(restored);
      setToken(saved);
      setHydrated(true);
      if (isOnline() && restored && saved) {
        // Offline is fine (keep going with what we have); only a real "signed out" ends it.
        checkSession(saved).then((r) => {
          if (!mounted) return;
          if ('signedOut' in r) forget(r.signedOut);
          else setSession((s) => (s ? { ...s, account: { ...s.account, ...r.account } } : s));
        }).catch(() => {});
      }
    })();
    return () => { mounted = false; };
  }, [forget]);

  useEffect(() => { setSessionToken(session ? token : null); }, [session, token]);

  useEffect(() => {
    if (hydrated && session) AsyncStorage.setItem(KEY, JSON.stringify(session)).catch(() => {});
  }, [session, hydrated]);

  const signIn = useCallback((account: Account, opts: { token?: string; created?: boolean } = {}) => {
    setSession({ account, signedInAt: new Date().toISOString(), newHome: !!opts.created && account.role === 'owner' });
    setEndedBecause(null);
    if (opts.token) {
      setToken(opts.token);
      tokenStore.set(opts.token);
    }
  }, []);

  const signOut = useCallback(async () => {
    const t = token;
    await forget(null);
    await getAuthService().signOut(t);
  }, [token, forget]);

  const sessionEnded = useCallback((why: string) => { forget(why); }, [forget]);

  const value = useMemo<Ctx>(
    () => ({
      account: session?.account ?? null, token, newHome: !!session?.newHome, hydrated, endedBecause,
      signIn, signOut, sessionEnded,
    }),
    [session, token, hydrated, endedBecause, signIn, signOut, sessionEnded],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
