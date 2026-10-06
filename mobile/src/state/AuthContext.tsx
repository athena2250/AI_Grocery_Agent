import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Account } from './auth';

/**
 * Who is signed in on this phone. The AuthScreen talks to AuthService and
 * hands the verified account here; signing out keeps the home's data.
 */
const KEY = 'hearth_session_v1';

interface Session {
  account: Account;
  signedInAt: string;
}

interface Ctx {
  account: Account | null;
  hydrated: boolean;
  signIn: (account: Account) => void;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<Ctx | null>(null);

const isAccount = (a: any): a is Account =>
  !!a && typeof a.phone === 'string' && typeof a.name === 'string' && typeof a.relation === 'string';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (mounted && isAccount(parsed?.account)) setSession(parsed);
      } catch {
        // signed out
      }
      if (mounted) setHydrated(true);
    })();
    return () => { mounted = false; };
  }, []);

  const signIn = useCallback((account: Account) => {
    const next = { account, signedInAt: new Date().toISOString() };
    setSession(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    setSession(null);
    await AsyncStorage.removeItem(KEY).catch(() => {});
  }, []);

  const value = useMemo<Ctx>(
    () => ({ account: session?.account ?? null, hydrated, signIn, signOut }),
    [session, hydrated, signIn, signOut],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
