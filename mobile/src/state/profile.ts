import type { HouseholdState } from '../types';
import { MEMBER_COLORS } from '../theme';

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

/**
 * Indian mobile number → E.164. Accepts spaces, dashes, a leading 0 or +91/91.
 * Returns null for blank input and 'invalid' when it isn't 10 digits.
 */
export function normalizePhone(input: string): string | null | 'invalid' {
  let d = input.replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : 'invalid';
}

/** `+919876543210` → `9876543210` (the part after the fixed +91). */
export const localPhone = (e164: string | null) => (e164 ? e164.slice(3) : '');

/**
 * What the phone field keeps as you type: digits only, at most 10. A pasted
 * `+91 98765 43210` or `098765 43210` loses its prefix first.
 */
export function phoneDigits(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  else if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

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
