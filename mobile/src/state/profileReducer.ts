import { linkAccount, type Member, type Profile } from './profile';
import type { Account } from './auth';

/**
 * Who lives here and what Hearth helps with, as one pure reducer so the shared
 * log (src/sync) replays the same on every phone. `meId` — who is holding
 * *this* phone — is not shared: each phone keeps its own (ProfileContext), and
 * the copy inside the shared state is ignored.
 */
export type MemberEdit = Partial<Pick<Member, 'name' | 'relation' | 'color' | 'phone' | 'diet' | 'dietFlags' | 'allergies' | 'dietNote'>>;

export type ProfileAction =
  | { type: 'HYDRATE'; payload: Profile }
  | { type: 'TOGGLE_MEMBER'; id: string }
  | { type: 'ADD_MEMBER'; member: Member }
  | { type: 'TOGGLE_MANAGE'; key: string }
  /** `meId`: whoever finished setup — they own the home unless it already has an owner. */
  | { type: 'FINISH_ONBOARDING'; meId: string }
  | { type: 'UPDATE_MEMBER'; id: string; edit: MemberEdit }
  | { type: 'MAKE_OWNER'; id: string }
  /** A signed-in account joins/claims its member row; `meId` is the sender's "me" at the time. */
  | { type: 'LINK_ACCOUNT'; account: Account; meId: string | null };

export function profileReducer(p: Profile, action: ProfileAction): Profile {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;
    case 'TOGGLE_MEMBER':
      return { ...p, members: p.members.map((m) => (m.id === action.id ? { ...m, on: !m.on } : m)) };
    case 'ADD_MEMBER':
      return p.members.some((m) => m.id === action.member.id) ? p : { ...p, members: [...p.members, action.member] };
    case 'TOGGLE_MANAGE':
      return { ...p, manage: p.manage.map((g) => (g.key === action.key ? { ...g, on: !g.on } : g)) };
    case 'FINISH_ONBOARDING':
      return { ...p, onboarded: true, ownerId: p.ownerId ?? action.meId };
    case 'UPDATE_MEMBER':
      return { ...p, members: p.members.map((m) => (m.id === action.id ? { ...m, ...action.edit } : m)) };
    case 'MAKE_OWNER':
      return p.members.some((m) => m.id === action.id) ? { ...p, ownerId: action.id } : p;
    case 'LINK_ACCOUNT':
      return linkAccount({ ...p, meId: action.meId }, action.account);
    default:
      return p;
  }
}
