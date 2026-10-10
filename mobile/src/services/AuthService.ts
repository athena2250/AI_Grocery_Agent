import type { Account, AuthError } from '../state/auth';

/**
 * The sign-in boundary. No codes are texted: a person gives their name and
 * number (`requestAccess`, which lets the admin know), the admin issues them a
 * passkey, and name + number + passkey signs them in. The sandbox
 * (MockAuthService) has no admin, so it hands the passkey straight back; the
 * HTTP one never does — same shapes, no UI changes.
 */
export interface AccessRequest {
  name: string;
  /** E.164 */
  phone: string;
}

export type AccessRequestResult =
  | {
    ok: true;
    /** Sandbox only: the passkey, since there is no admin to ask. A real service never returns it. */
    sandboxPasskey?: string;
  }
  | { ok: false; error: AuthError; message: string };

export interface PasskeySignIn extends AccessRequest {
  passkey: string;
}

export type SignInResult =
  | {
    ok: true;
    account: Account;
    /** First sign-in for this person. */
    created: boolean;
    /** Server mode: the session key for every later request. */
    token?: string;
  }
  | { ok: false; error: AuthError; message: string };

export interface AuthService {
  /** Name + number → the admin sees who is asking. Never says whether the number already has a passkey. */
  requestAccess(req: AccessRequest): Promise<AccessRequestResult>;
  signInWithPasskey(req: PasskeySignIn): Promise<SignInResult>;
  /** Sandbox reset: forget every account on this phone. */
  forgetAll(): Promise<void>;
  /** Ends the session on the server (a no-op in the sandbox). */
  signOut(token: string | null): Promise<void>;
  /** "Delete my account" (store rule): removes the account; true when the home was deleted with it. */
  deleteAccount(account: Account, token: string | null): Promise<{ ok: true; householdDeleted: boolean } | { ok: false; message: string }>;
}
