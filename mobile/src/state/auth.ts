/**
 * Sign-in rules. Pure — MockAuthService holds the accounts and passkeys; the
 * server's `/auth` endpoints apply the same rules. There is no self sign-up:
 * a person gives their name and number, the admin issues them a passkey, and
 * name + number + passkey signs them in. The phone number (E.164) is the
 * account key.
 */
export interface Account {
  /** E.164 — the account key. */
  phone: string;
  name: string;
  /** Who they are at home: Mom, Dad, Son … (backend `member.relation`, set by the admin). */
  relation: string;
  createdAt: string;
  /** Server mode only (backend `member.id`, `member.household_id`, `member.role`). */
  memberId?: string;
  householdId?: string;
  role?: 'owner' | 'member';
}

/** "K7M4-PX9Q": 8 characters, no 0/O or 1/I/L, so it can be read out over the phone. */
export const PASSKEY_LENGTH = 8;
export const PASSKEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60_000;

/** "  Lakshmi  Rao " and "lakshmirao" are the same name; case and spaces don't count. */
export const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, '');

/** Tidy a typed name for storing: trimmed, single spaces. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ');

/** What was typed → the bare passkey: "k7m4 px9q", "K7M4-PX9Q" → "K7M4PX9Q". */
export const passkeyKey = (typed: string) => typed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PASSKEY_LENGTH);

/** For the input and for showing: "K7M4PX9Q" → "K7M4-PX9Q" (the dash appears as you type). */
export function formatPasskey(typed: string): string {
  const k = passkeyKey(typed);
  return k.length > 4 ? `${k.slice(0, 4)}-${k.slice(4)}` : k;
}

/** A random passkey; `random` is injectable so tests are repeatable. */
export function makePasskey(random: () => number = Math.random): string {
  return Array.from({ length: PASSKEY_LENGTH }, () => PASSKEY_ALPHABET[Math.floor(random() * PASSKEY_ALPHABET.length)]).join('');
}

export type AuthError =
  | 'invalid_name' | 'invalid_phone' | 'invalid_passkey' | 'wrong_details' | 'locked'
  // From the server, plus transport errors.
  | 'rate_limited' | 'not_allowed' | 'network' | 'server';

export const AUTH_MESSAGES: Record<AuthError, string> = {
  invalid_name: 'Please tell us your name.',
  invalid_phone: 'That doesn’t look like a mobile number.',
  invalid_passkey: `The passkey has ${PASSKEY_LENGTH} letters and numbers.`,
  wrong_details: 'Those details don’t match. Check your name, number and passkey.',
  locked: 'Too many tries. Wait 15 minutes, or ask the admin for a new passkey.',
  rate_limited: 'Too many tries. Please try again later.',
  not_allowed: 'You can’t do that for this home.',
  network: 'No connection. Check the internet and try again.',
  server: 'Something went wrong. Please try again.',
};

export interface PasskeyRecord {
  /** The name given when asking — becomes the account's name on first sign-in. */
  name: string;
  passkey: string;
  attemptsLeft: number;
  /** Epoch ms; set after too many wrong tries. */
  lockedUntil?: number;
}

export type PasskeyCheck =
  | { ok: true }
  | { ok: false; error: 'locked'; lockedUntil: number }
  | { ok: false; error: 'wrong_details'; record?: PasskeyRecord };

/**
 * One answer for every mismatch — unknown number, wrong name, wrong passkey —
 * so the screen never says which part was wrong. Too many wrong tries lock the
 * number for 15 minutes; a right one resets the count.
 */
export function checkPasskey(
  record: PasskeyRecord | undefined, accountName: string | undefined, name: string, passkey: string, now: number,
): PasskeyCheck {
  if (!record) return { ok: false, error: 'wrong_details' };
  if (record.lockedUntil && now < record.lockedUntil) return { ok: false, error: 'locked', lockedUntil: record.lockedUntil };
  const right = passkeyKey(passkey) === record.passkey && nameKey(accountName ?? record.name) === nameKey(name);
  if (right) return { ok: true };
  const attemptsLeft = (record.lockedUntil ? MAX_ATTEMPTS : record.attemptsLeft) - 1;
  if (attemptsLeft <= 0) {
    const lockedUntil = now + LOCK_MS;
    return { ok: false, error: 'locked', lockedUntil };
  }
  return { ok: false, error: 'wrong_details', record: { ...record, attemptsLeft, lockedUntil: undefined } };
}
