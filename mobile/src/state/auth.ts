/**
 * Sign-in / sign-up rules. Pure — MockAuthService holds the accounts and the
 * pending codes; Phase 2's `/auth` endpoints apply the same rules server-side.
 * The phone number (E.164) is the account key; the name must match it.
 */
export interface Account {
  /** E.164 — the account key. */
  phone: string;
  name: string;
  /** Who they are at home: Mom, Dad, Son … (backend `member.relation`). */
  relation: string;
  createdAt: string;
  /** Server mode only (backend `member.id`, `member.household_id`, `member.role`). */
  memberId?: string;
  householdId?: string;
  role?: 'owner' | 'member';
}

export type AuthMode = 'sign_in' | 'sign_up';

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60_000;
export const RESEND_AFTER_MS = 30_000;
export const MAX_ATTEMPTS = 5;

/** Relations offered as chips at sign-up; anything else is typed. */
export const RELATIONS = ['Mom', 'Dad', 'Son', 'Daughter', 'Grandma', 'Grandpa'];

/** "  Lakshmi  Rao " and "lakshmirao" are the same name; case and spaces don't count. */
export const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, '');

/** Tidy a typed name for storing: trimmed, single spaces. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ');

export interface PendingOtp {
  mode: AuthMode;
  phone: string;
  code: string;
  /** Epoch ms. */
  expiresAt: number;
  resendAt: number;
  attemptsLeft: number;
  /** Sign-up only: the account to create once the code is right. */
  draft?: Omit<Account, 'createdAt'>;
}

export type AuthError =
  | 'invalid_name' | 'invalid_relation' | 'no_account' | 'account_exists' | 'name_mismatch'
  | 'resend_too_soon' | 'no_code' | 'expired' | 'wrong_code' | 'too_many_attempts'
  // From the server (backend/app/auth/store.py MESSAGES, plus transport errors).
  | 'invalid_phone' | 'removed' | 'invalid_invite' | 'phone_in_other_home' | 'phone_taken'
  | 'rate_limited' | 'not_allowed' | 'sms_failed' | 'network' | 'server';

export const AUTH_MESSAGES: Record<AuthError, string> = {
  invalid_name: 'Please tell us your name.',
  invalid_relation: 'Please choose who you are at home.',
  no_account: 'There’s no account for this number yet. Sign up instead?',
  account_exists: 'This number already has an account. Sign in instead?',
  name_mismatch: 'That name doesn’t match the account for this number.',
  resend_too_soon: 'Please wait a moment before asking for another code.',
  no_code: 'Ask for a code first.',
  expired: 'That code has expired. Send a new one.',
  wrong_code: 'That code isn’t right. Check it and try again.',
  too_many_attempts: 'Too many tries. Send a new code.',
  invalid_phone: 'That doesn’t look like a mobile number.',
  removed: 'This number was taken out of its home. Ask someone there to add it again.',
  invalid_invite: 'That home code isn’t working. It may have expired — ask for a new one.',
  phone_in_other_home: 'This number already belongs to another home.',
  phone_taken: 'Someone already uses this number.',
  rate_limited: 'Too many codes for this number. Please try again later.',
  not_allowed: 'You can’t do that for this home.',
  sms_failed: 'We couldn’t text you just now. Try again.',
  network: 'No connection. Check the internet and try again.',
  server: 'Something went wrong. Please try again.',
};

/** A random 6-digit code; `random` is injectable so tests are repeatable. */
export function makeCode(random: () => number = Math.random): string {
  return Array.from({ length: OTP_LENGTH }, () => Math.floor(random() * 10)).join('');
}

/** Can this person ask for a code at all? Checked before any code is sent. */
export function checkRequest(
  mode: AuthMode, name: string, relation: string | undefined, existing: Account | undefined,
): AuthError | null {
  if (!cleanName(name)) return 'invalid_name';
  if (mode === 'sign_up') {
    if (!relation?.trim()) return 'invalid_relation';
    if (existing) return 'account_exists';
    return null;
  }
  if (!existing) return 'no_account';
  return nameKey(existing.name) === nameKey(name) ? null : 'name_mismatch';
}

export type OtpCheck =
  | { ok: true }
  | { ok: false; error: 'no_code' | 'expired' | 'too_many_attempts' }
  | { ok: false; error: 'wrong_code'; pending: PendingOtp };

/** Checks a typed code. A wrong code returns the pending code with one fewer try. */
export function checkCode(pending: PendingOtp | undefined, code: string, now: number): OtpCheck {
  if (!pending) return { ok: false, error: 'no_code' };
  if (now >= pending.expiresAt) return { ok: false, error: 'expired' };
  if (pending.attemptsLeft <= 0) return { ok: false, error: 'too_many_attempts' };
  if (code.replace(/\D/g, '') === pending.code) return { ok: true };
  const attemptsLeft = pending.attemptsLeft - 1;
  if (attemptsLeft <= 0) return { ok: false, error: 'too_many_attempts' };
  return { ok: false, error: 'wrong_code', pending: { ...pending, attemptsLeft } };
}

/** "0:24" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
