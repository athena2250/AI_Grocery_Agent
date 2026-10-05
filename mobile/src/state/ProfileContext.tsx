import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEMBER_COLORS } from '../theme';

/**
 * Who lives here + what Hearth helps with — the onboarding answers. Kept apart
 * from HouseholdState (grocery memory) under its own storage key, so the
 * grocery reducer and its migrations stay untouched.
 */
export interface Member {
  name: string;
  role: string;
  color: string;
  on: boolean;
}

export interface ManageArea {
  key: 'groceries' | 'bills' | 'repairs' | 'travel' | 'inventory';
  name: string;
  desc: string;
  on: boolean;
  /** Works in the sandbox today; the rest arrive with the family feed. */
  live: boolean;
}

export interface Profile {
  onboarded: boolean;
  members: Member[];
  manage: ManageArea[];
}

const KEY = 'hearth_profile_v1';

export const DEFAULT_PROFILE: Profile = {
  onboarded: false,
  members: [
    { name: 'Lakshmi', role: 'Mom', color: MEMBER_COLORS[0], on: true },
    { name: 'Ravi', role: 'Dad', color: MEMBER_COLORS[1], on: true },
    { name: 'Ananya', role: 'Me', color: MEMBER_COLORS[2], on: true },
  ],
  manage: [
    { key: 'groceries', name: 'Groceries', desc: 'Lists, aisles & smart repeat', on: true, live: true },
    { key: 'inventory', name: 'Pantry', desc: 'What the home keeps in stock', on: true, live: true },
    { key: 'bills', name: 'Bills', desc: 'Due dates & amounts · coming soon', on: false, live: false },
    { key: 'repairs', name: 'Home Repairs', desc: 'Fixes & services · coming soon', on: false, live: false },
    { key: 'travel', name: 'Travel & Plans', desc: 'Trips & bookings · coming soon', on: false, live: false },
  ],
};

/** Who else might be added from onboarding's "Add someone" (the design's queue). */
const MORE_PEOPLE = [
  { name: 'Grandma', role: 'Family' },
  { name: 'Aarav', role: 'Son' },
  { name: 'Meera', role: 'Daughter' },
];

interface Ctx {
  profile: Profile;
  hydrated: boolean;
  /** The person using this phone — the first member, by convention. */
  me: Member;
  activeMembers: Member[];
  toggleMember: (i: number) => void;
  /** Returns false when there's nobody left to add. */
  addMember: () => boolean;
  toggleManage: (i: number) => void;
  finishOnboarding: () => void;
  resetProfile: () => Promise<void>;
}

const ProfileCtx = createContext<Ctx | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (mounted && raw) setProfile({ ...DEFAULT_PROFILE, ...JSON.parse(raw) });
      } catch {
        // fall back to defaults
      }
      if (mounted) setHydrated(true);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(KEY, JSON.stringify(profile)).catch(() => {});
  }, [profile, hydrated]);

  const toggleMember = useCallback((i: number) => setProfile((p) => ({
    ...p, members: p.members.map((m, j) => (j === i ? { ...m, on: !m.on } : m)),
  })), []);

  const addMember = useCallback(() => {
    const next = MORE_PEOPLE.find((x) => !profile.members.some((m) => m.name === x.name));
    if (!next) return false;
    setProfile((p) => ({
      ...p,
      members: [...p.members, { ...next, color: MEMBER_COLORS[p.members.length % MEMBER_COLORS.length], on: true }],
    }));
    return true;
  }, [profile.members]);

  const toggleManage = useCallback((i: number) => setProfile((p) => ({
    ...p, manage: p.manage.map((g, j) => (j === i ? { ...g, on: !g.on } : g)),
  })), []);

  const finishOnboarding = useCallback(() => setProfile((p) => ({ ...p, onboarded: true })), []);

  const resetProfile = useCallback(async () => {
    await AsyncStorage.removeItem(KEY).catch(() => {});
    setProfile(DEFAULT_PROFILE);
  }, []);

  const value = useMemo<Ctx>(() => {
    const activeMembers = profile.members.filter((m) => m.on);
    return {
      profile, hydrated, me: activeMembers[0] ?? profile.members[0], activeMembers,
      toggleMember, addMember, toggleManage, finishOnboarding, resetProfile,
    };
  }, [profile, hydrated, toggleMember, addMember, toggleManage, finishOnboarding, resetProfile]);

  return <ProfileCtx.Provider value={value}>{children}</ProfileCtx.Provider>;
}

export function useProfile(): Ctx {
  const ctx = useContext(ProfileCtx);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
