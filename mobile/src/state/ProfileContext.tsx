import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEMBER_COLORS } from '../theme';
import { DEFAULT_PROFILE, currentMe, linkAccount, migrateProfile, newMember, type Member, type Profile } from './profile';
import { profileReducer, type MemberEdit, type ProfileAction } from './profileReducer';
import type { Account } from './auth';
import { useSyncedReducer } from '../sync/useSyncedReducer';

export type { Member, ManageArea, Profile } from './profile';
export type { MemberEdit } from './profileReducer';
export { DEFAULT_PROFILE } from './profile';

/**
 * Onboarding answers + who holds this phone, kept apart from HouseholdState
 * (grocery memory) under its own storage key, so the grocery reducer and its
 * migrations stay untouched. Shapes and migration live in ./profile, the rules
 * in ./profileReducer.
 *
 * Signed in to the server, the members and setup are the family's (shared like
 * the list); "me" — who is holding this phone — is always this phone's own.
 */
const KEY = 'hearth_profile_v1';
const ME_KEY = 'hearth_me_v1';

/** Who else might be added from onboarding's "Add someone" (the design's queue). */
const MORE_PEOPLE = [
  { name: 'Grandma', relation: 'Grandma' },
  { name: 'Aarav', relation: 'Son' },
  { name: 'Meera', relation: 'Daughter' },
];

interface Ctx {
  profile: Profile;
  hydrated: boolean;
  /** The person using this phone — chosen on their profile, else the first ticked. */
  me: Member;
  ownerId: string | null;
  activeMembers: Member[];
  /** Signed in to the server: members are shared with the family. */
  shared: boolean;
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
  /**
   * Deleting my account: my row in the family's list becomes "Former member" with no
   * number or health notes, and is sent before the session ends. False if it couldn't be sent.
   */
  forgetMe: () => Promise<boolean>;
}

const ProfileCtx = createContext<Ctx | null>(null);

async function loadLocal(): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? migrateProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const saveLocal = (p: Profile) => { AsyncStorage.setItem(KEY, JSON.stringify(p)).catch(() => {}); };
const hydrateAction = (payload: Profile): ProfileAction => ({ type: 'HYDRATE', payload });
const sameMembers = (a: Member[], b: Member[]) => JSON.stringify(a) === JSON.stringify(b);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { state, dispatch, flushNow, hydrated: stateReady, shared, clearShared } = useSyncedReducer({
    stream: 'profile',
    reducer: profileReducer,
    initial: DEFAULT_PROFILE,
    hydrate: hydrateAction,
    loadLocal,
    saveLocal,
  });

  // "Me" on this phone. Before it was split out it lived inside the profile.
  const [meId, setMeId] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = await AsyncStorage.getItem(ME_KEY).catch(() => null);
      const legacy = saved === null ? (await loadLocal())?.meId ?? null : null;
      if (!mounted) return;
      setMeId(saved ?? legacy);
      setMeReady(true);
    })();
    return () => { mounted = false; };
  }, []);
  const chooseMe = useCallback((id: string | null) => {
    setMeId(id);
    if (id) AsyncStorage.setItem(ME_KEY, id).catch(() => {});
    else AsyncStorage.removeItem(ME_KEY).catch(() => {});
  }, []);

  const profile = useMemo<Profile>(() => ({ ...state, meId }), [state, meId]);
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const toggleMember = useCallback((i: number) => {
    const m = profileRef.current.members[i];
    if (m) dispatch({ type: 'TOGGLE_MEMBER', id: m.id });
  }, [dispatch]);

  const addMember = useCallback(() => {
    const p = profileRef.current;
    const next = MORE_PEOPLE.find((x) => !p.members.some((m) => m.name === x.name));
    if (!next) return false;
    dispatch({ type: 'ADD_MEMBER', member: newMember(next.name, next.relation, MEMBER_COLORS[p.members.length % MEMBER_COLORS.length]) });
    return true;
  }, [dispatch]);

  const toggleManage = useCallback((i: number) => {
    const g = profileRef.current.manage[i];
    if (g) dispatch({ type: 'TOGGLE_MANAGE', key: g.key });
  }, [dispatch]);

  // Whoever is "me" at the end of setup set the phone up, so they own the home.
  const finishOnboarding = useCallback(() => {
    const id = currentMe(profileRef.current).id;
    chooseMe(id);
    dispatch({ type: 'FINISH_ONBOARDING', meId: id });
  }, [dispatch, chooseMe]);

  const updateMember = useCallback((id: string, edit: MemberEdit) => dispatch({ type: 'UPDATE_MEMBER', id, edit }), [dispatch]);
  const setMe = useCallback((id: string) => chooseMe(id), [chooseMe]);
  const makeOwner = useCallback((id: string) => dispatch({ type: 'MAKE_OWNER', id }), [dispatch]);

  // Runs whenever the session or profile changes, so it only logs a change when there is one.
  const link = useCallback((account: Account) => {
    const p = profileRef.current;
    const next = linkAccount(p, account);
    if (!sameMembers(next.members, p.members)) dispatch({ type: 'LINK_ACCOUNT', account, meId: p.meId });
    if (next.meId !== p.meId) chooseMe(next.meId);
  }, [dispatch, chooseMe]);

  const resetProfile = useCallback(async () => {
    chooseMe(null);
    if (shared) { await clearShared(); return; }
    await AsyncStorage.removeItem(KEY).catch(() => {});
    dispatch({ type: 'HYDRATE', payload: DEFAULT_PROFILE });
  }, [shared, clearShared, dispatch, chooseMe]);

  const forgetMe = useCallback(async () => {
    const id = currentMe(profileRef.current).id;
    dispatch({
      type: 'UPDATE_MEMBER', id,
      edit: { name: 'Former member', relation: 'Family', phone: null, diet: null, dietFlags: [], allergies: [], dietNote: '' },
    });
    const m = profileRef.current.members.find((x) => x.id === id);
    if (m?.on) dispatch({ type: 'TOGGLE_MEMBER', id });
    return shared ? flushNow() : true;
  }, [dispatch, flushNow, shared]);

  const value = useMemo<Ctx>(() => {
    const activeMembers = profile.members.filter((m) => m.on);
    return {
      profile, hydrated: stateReady && meReady, me: currentMe(profile), ownerId: profile.ownerId, activeMembers, shared,
      toggleMember, addMember, toggleManage, finishOnboarding, updateMember, setMe, makeOwner, linkAccount: link, resetProfile, forgetMe,
    };
  }, [profile, stateReady, meReady, shared, toggleMember, addMember, toggleManage, finishOnboarding, updateMember, setMe, makeOwner, link, resetProfile, forgetMe]);

  return <ProfileCtx.Provider value={value}>{children}</ProfileCtx.Provider>;
}

export function useProfile(): Ctx {
  const ctx = useContext(ProfileCtx);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
