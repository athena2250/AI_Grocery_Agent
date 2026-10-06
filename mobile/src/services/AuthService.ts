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
  | { ok: true; account: Account; created: boolean }
  | { ok: false; error: AuthError; message: string; attemptsLeft?: number };

export interface AuthService {
  requestOtp(req: OtpRequest): Promise<OtpRequestResult>;
  verifyOtp(phone: string, code: string): Promise<VerifyResult>;
  /** Sandbox reset: forget every account on this phone. */
  forgetAll(): Promise<void>;
}
