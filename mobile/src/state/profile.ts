import type { HouseholdState } from '../types';
import { MEMBER_COLORS } from '../theme';
import { INDIA, localDigits, splitE164, toE164 } from './phone';
import { nameKey, type Account } from './auth';

/**
 * Who lives here, what Hearth helps with, and who is holding this phone. Pure
 * shapes + helpers; ProfileContext owns storage. Fields mirror the backend
 * `member` table (relation, phone as E.164, role owner/member).
 */

/** One per person — what they eat. Diet notes are display-only in the sandbox. */
export const DIET_TYPES = ['Vegetarian', 'Eggetarian', 'Non-vegetarian', 'Jain', 'Vegan'] as const;
export type DietType = (typeof DIET_TYPES)[number];

/** Any number per person, on top of the diet type. */
export const DIET_FLAGS = ['No onion-garlic', 'Diabetic', 'Low salt', 'Low oil'] as const;

export interface Member {
  id: string;
  name: string;
  /** Free text: Mom, Dad, Son, Grandma … (backend `member.relation`). */
  relation: string;
  color: string;
  /** In the home (ticked at onboarding). */
  on: boolean;
  /** E.164, `+91XXXXXXXXXX`, or null. */
  phone: string | null;
  diet: DietType | null;
  dietFlags: string[];
  allergies: string[];
  dietNote: string;
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
  /** The person using this phone. */
  meId: string | null;
  /** Backend role `owner` — whoever set up the phone, unless handed over. */
  ownerId: string | null;
}

export const newMember = (name: string, relation: string, color: string, id = memberId(name)): Member => ({
  id, name, relation, color, on: true, phone: null, diet: null, dietFlags: [], allergies: [], dietNote: '',
});

export const memberId = (name: string) => `m_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

export const DEFAULT_PROFILE: Profile = {
  onboarded: false,
  members: [
    newMember('Lakshmi', 'Mom', MEMBER_COLORS[0], 'm_mom'),
    newMember('Ravi', 'Dad', MEMBER_COLORS[1], 'm_dad'),
    newMember('Ananya', 'Daughter', MEMBER_COLORS[2], 'm_ananya'),
  ],
  manage: [
    { key: 'groceries', name: 'Groceries', desc: 'Lists, aisles & smart repeat', on: true, live: true },
    { key: 'inventory', name: 'Pantry', desc: 'What the home keeps in stock', on: true, live: true },
    { key: 'bills', name: 'Bills', desc: 'Due dates & amounts · coming soon', on: false, live: false },
    { key: 'repairs', name: 'Home Repairs', desc: 'Fixes & services · coming soon', on: false, live: false },
    { key: 'travel', name: 'Travel & Plans', desc: 'Trips & bookings · coming soon', on: false, live: false },
  ],
  meId: null,
  ownerId: null,
};

/** Indian mobile number → E.164 (India-only shorthands kept for older callers; see ./phone). */
export const normalizePhone = (input: string) => toE164(INDIA, input);

/** `+919876543210` → `9876543210` (the part after the dial code). */
export const localPhone = (e164: string | null) => splitE164(e164).local;

/** Digits-only Indian phone field, at most 10. */
export const phoneDigits = (input: string) => localDigits(INDIA, input);

/** The person on this phone: the chosen one if still in the home, else the first ticked. */
export function currentMe(p: Profile): Member {
  const active = p.members.filter((m) => m.on);
  return active.find((m) => m.id === p.meId) ?? active[0] ?? p.members[0];
}

/**
 * Bring a stored profile up to today's shape. v1 members had `role` ("Mom")
 * and no id; "Me" was a relation, now it's `meId`.
 */
export function migrateProfile(raw: any): Profile {
  if (!raw || typeof raw !== 'object') return DEFAULT_PROFILE;
  const seen = new Set<string>();
  const members: Member[] = (Array.isArray(raw.members) ? raw.members : DEFAULT_PROFILE.members).map((m: any, i: number) => {
    const fallback = DEFAULT_PROFILE.members.find((d) => d.name === m.name);
    let id: string = m.id ?? fallback?.id ?? memberId(String(m.name ?? `member_${i}`));
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const relation = m.relation ?? (m.role && m.role !== 'Me' ? m.role : fallback?.relation ?? 'Family');
    return {
      ...newMember(String(m.name ?? 'Someone'), relation, m.color ?? MEMBER_COLORS[i % MEMBER_COLORS.length], id),
      on: m.on ?? true,
      phone: typeof m.phone === 'string' ? m.phone : null,
      diet: DIET_TYPES.includes(m.diet) ? m.diet : null,
      dietFlags: Array.isArray(m.dietFlags) ? m.dietFlags : [],
      allergies: Array.isArray(m.allergies) ? m.allergies : [],
      dietNote: typeof m.dietNote === 'string' ? m.dietNote : '',
    };
  });
  const base: Profile = {
    onboarded: !!raw.onboarded,
    members,
    manage: Array.isArray(raw.manage) ? raw.manage : DEFAULT_PROFILE.manage,
    meId: typeof raw.meId === 'string' ? raw.meId : null,
    ownerId: typeof raw.ownerId === 'string' ? raw.ownerId : null,
  };
  if (!base.onboarded) return base;
  // An onboarded v1 profile: "me" was the first ticked person, and they set the phone up.
  const meId = base.meId ?? currentMe(base).id;
  return { ...base, meId, ownerId: base.ownerId ?? meId };
}

/**
 * Make a signed-in account "me" in this home. Idempotent, so it runs whenever
 * the session or the profile changes. Matches, in order: the member with that
 * phone; the current "me" if the name matches; a member with the same name and no phone yet; before setup, the
 * sample member with the same relation (so "Priya, Mom" replaces the sample
 * Mom); otherwise the account joins the home as a new member.
 */
export function linkAccount(p: Profile, account: Account): Profile {
  const claim = (id: string, edit: Partial<Member>): Profile => ({
    ...p,
    meId: id,
    members: p.members.map((m) => (m.id === id ? { ...m, ...edit, on: true } : m)),
  });
  const details = { name: account.name, relation: account.relation, phone: account.phone };

  const byPhone = p.members.find((m) => m.phone === account.phone);
  if (byPhone) return byPhone.on && p.meId === byPhone.id ? p : claim(byPhone.id, {});

  // Already "me" here (their family-facing number may differ from the sign-in one).
  const current = p.members.find((m) => m.id === p.meId);
  if (current?.on && nameKey(current.name) === nameKey(account.name)) return p;

  const byName = p.members.find((m) => !m.phone && nameKey(m.name) === nameKey(account.name));
  if (byName) return claim(byName.id, details);

  const byRelation = !p.onboarded
    && p.members.find((m) => !m.phone && m.relation.toLowerCase() === account.relation.toLowerCase());
  if (byRelation) return claim(byRelation.id, details);

  let id = memberId(account.name);
  while (p.members.some((m) => m.id === id)) id = `${id}_`;
  const added = { ...newMember(account.name, account.relation, MEMBER_COLORS[p.members.length % MEMBER_COLORS.length], id), phone: account.phone };
  return { ...p, meId: id, members: p.onboarded ? [...p.members, added] : [added, ...p.members] };
}

export interface Activity {
  itemsAdded: number;
  purchases: number;
}

/** What a member has done, from the tags on list rows and purchases (untagged older rows count for nobody). */
export function memberActivity(state: Pick<HouseholdState, 'listItems' | 'history'>, id: string): Activity {
  return {
    itemsAdded: state.listItems.filter((li) => li.addedByMemberId === id && li.status !== 'removed').length,
    purchases: state.history.filter((h) => h.memberId === id).length,
  };
}
