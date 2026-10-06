import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEMBER_COLORS } from '../theme';
import { DEFAULT_PROFILE, currentMe, linkAccount, migrateProfile, newMember, type Member, type Profile } from './profile';
import type { Account } from './auth';

export type { Member, ManageArea, Profile } from './profile';
export { DEFAULT_PROFILE } from './profile';

/**
 * Onboarding answers + who holds this phone, kept apart from HouseholdState
 * (grocery memory) under its own storage key, so the grocery reducer and its
 * migrations stay untouched. Shapes and migration live in ./profile.
 */
const KEY = 'hearth_profile_v1';

/** Who else might be added from onboarding's "Add someone" (the design's queue). */
const MORE_PEOPLE = [
  { name: 'Grandma', relation: 'Grandma' },
  { name: 'Aarav', relation: 'Son' },
  { name: 'Meera', relation: 'Daughter' },
];

/** What the profile page may change about a person. */
export type MemberEdit = Partial<Pick<Member, 'name' | 'relation' | 'color' | 'phone' | 'diet' | 'dietFlags' | 'allergies' | 'dietNote'>>;

interface Ctx {
  profile: Profile;
  hydrated: boolean;
  /** The person using this phone — chosen on their profile, else the first ticked. */
  me: Member;
  ownerId: string | null;
  activeMembers: Member[];
  toggleMember: (i: number) => void;
  /** Returns false when there's nobody left to add. */
  addMember: () => boolean;
  toggleManage: (i: number) => void;
  finishOnboarding: () => void;
  updateMember: (id: string, edit: MemberEdit) => void;
  /** "This is me" — hand the phone to someone without redoing onboarding. */
  setMe: (id: string) => void;
  /** The owner passes ownership on (backend role owner → member). */
  makeOwner: (id: string) => void;
  /** The signed-in account becomes "me" (see profile.linkAccount). */
  linkAccount: (account: Account) => void;
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
        if (mounted && raw) setProfile(migrateProfile(JSON.parse(raw)));
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
      members: [...p.members, newMember(next.name, next.relation, MEMBER_COLORS[p.members.length % MEMBER_COLORS.length])],
    }));
    return true;
  }, [profile.members]);

  const toggleManage = useCallback((i: number) => setProfile((p) => ({
    ...p, manage: p.manage.map((g, j) => (j === i ? { ...g, on: !g.on } : g)),
  })), []);

  // Whoever is "me" at the end of setup set the phone up, so they own the home.
  const finishOnboarding = useCallback(() => setProfile((p) => {
    const meId = currentMe(p).id;
    return { ...p, onboarded: true, meId, ownerId: p.ownerId ?? meId };
  }), []);

  const updateMember = useCallback((id: string, edit: MemberEdit) => setProfile((p) => ({
    ...p, members: p.members.map((m) => (m.id === id ? { ...m, ...edit } : m)),
  })), []);

  const setMe = useCallback((id: string) => setProfile((p) => ({ ...p, meId: id })), []);

  const makeOwner = useCallback((id: string) => setProfile((p) => ({ ...p, ownerId: id })), []);

  const link = useCallback((account: Account) => setProfile((p) => linkAccount(p, account)), []);

  const resetProfile = useCallback(async () => {
    await AsyncStorage.removeItem(KEY).catch(() => {});
    setProfile(DEFAULT_PROFILE);
  }, []);

  const value = useMemo<Ctx>(() => {
    const activeMembers = profile.members.filter((m) => m.on);
    return {
      profile, hydrated, me: currentMe(profile), ownerId: profile.ownerId, activeMembers,
      toggleMember, addMember, toggleManage, finishOnboarding, updateMember, setMe, makeOwner, linkAccount: link, resetProfile,
    };
  }, [profile, hydrated, toggleMember, addMember, toggleManage, finishOnboarding, updateMember, setMe, makeOwner, link, resetProfile]);

  return <ProfileCtx.Provider value={value}>{children}</ProfileCtx.Provider>;
}

export function useProfile(): Ctx {
  const ctx = useContext(ProfileCtx);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
