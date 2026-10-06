import type { Account, AuthError, AuthMode } from '../state/auth';

/**
 * The sign-in boundary. Phase 1 uses MockAuthService (codes shown on screen,
 * accounts on this phone); Phase 2 swaps in an HTTP one that texts the code —
 * same shapes, no UI changes.
 */
export interface OtpRequest {
  mode: AuthMode;
  name: string;
  /** E.164 */
  phone: string;
  /** Sign-up only. */
  relation?: string;
  /** Sign-up only, server mode: a home code ("HRTH-4K9P") to join a family instead of starting a home. */
  inviteCode?: string;
}

export type OtpRequestResult =
  | {
    ok: true;
    /** Epoch ms. */
    expiresAt: number;
    resendAt: number;
    /** Sandbox only: the code, since no SMS is sent. A real service never returns it. */
    devCode?: string;
  }
  | { ok: false; error: AuthError; message: string; resendAt?: number };

export type VerifyResult =
  | {
    ok: true;
    account: Account;
    created: boolean;
    /** Server mode: the session key for every later request. */
    token?: string;
  }
  | { ok: false; error: AuthError; message: string; attemptsLeft?: number };

export interface AuthService {
  requestOtp(req: OtpRequest): Promise<OtpRequestResult>;
  verifyOtp(phone: string, code: string): Promise<VerifyResult>;
  /** Sandbox reset: forget every account on this phone. */
  forgetAll(): Promise<void>;
  /** Ends the session on the server (a no-op in the sandbox). */
  signOut(token: string | null): Promise<void>;
  /** "Delete my account" (store rule): removes the account; true when the home was deleted with it. */
  deleteAccount(account: Account, token: string | null): Promise<{ ok: true; householdDeleted: boolean } | { ok: false; message: string }>;
  /** A home code for family to join with — null in the sandbox (no server to join). */
  createInvite(token: string | null): Promise<{ code: string; expiresAt: number } | { error: string; message: string } | null>;
}
