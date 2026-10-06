import { Platform } from 'react-native';
import type { AuthService, OtpRequest, OtpRequestResult, VerifyResult } from './AuthService';
import { AUTH_MESSAGES, type Account, type AuthError, type AuthMode } from '../state/auth';
import { ApiError, api } from './api';

interface ServerAccount {
  memberId: string; householdId: string; name: string; relation: string;
  phone: string; role: 'owner' | 'member'; createdAt: string;
}

const toAccount = (a: ServerAccount): Account => ({
  phone: a.phone, name: a.name, relation: a.relation, createdAt: a.createdAt,
  memberId: a.memberId, householdId: a.householdId, role: a.role,
});

function fail(e: unknown, extra: object = {}) {
  const err = e instanceof ApiError ? e : new ApiError(0, 'server', AUTH_MESSAGES.server);
  const error = (err.error in AUTH_MESSAGES ? err.error : 'server') as AuthError;
  return { ok: false as const, error, message: err.message || AUTH_MESSAGES[error], ...extra, ...pick(err.detail) };
}

/** `resend_after` → `resendAt`, `attempts_left` → `attemptsLeft` (the server's refusal details). */
function pick(d: Record<string, unknown>) {
  return {
    ...(typeof d.resend_after === 'number' ? { resendAt: d.resend_after } : {}),
    ...(typeof d.attempts_left === 'number' ? { attemptsLeft: d.attempts_left } : {}),
  };
}

/** Real sign-in: the server texts the code (backend `/auth/*`). */
export class HttpAuthService implements AuthService {
  /** The mode each number asked a code for — verify needs it. */
  private modes = new Map<string, AuthMode>();

  async requestOtp(req: OtpRequest): Promise<OtpRequestResult> {
    try {
      const r = await api<{ expiresAt: number; resendAt: number; devCode?: string }>('/auth/code', {
        body: {
          mode: req.mode, phone: req.phone, name: req.name, relation: req.relation ?? null,
          inviteCode: req.inviteCode?.trim() || null,
        },
      });
      this.modes.set(req.phone, req.mode);
      return { ok: true, ...r };
    } catch (e) {
      return fail(e);
    }
  }

  async verifyOtp(phone: string, code: string): Promise<VerifyResult> {
    const mode = this.modes.get(phone);
    if (!mode) return fail(new ApiError(400, 'no_code', AUTH_MESSAGES.no_code));
    try {
      const r = await api<{ token: string; created: boolean; account: ServerAccount }>('/auth/verify', {
        body: { mode, phone, code, deviceLabel: Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : Platform.OS },
      });
      this.modes.delete(phone);
      return { ok: true, account: toAccount(r.account), created: r.created, token: r.token };
    } catch (e) {
      return fail(e);
    }
  }

  async signOut(token: string | null): Promise<void> {
    if (!token) return;
    await api('/auth/sign-out', { body: {}, token }).catch(() => {});
  }

  async deleteAccount(_account: Account, token: string | null) {
    try {
      const r = await api<{ ok: true; householdDeleted: boolean }>('/me', { method: 'DELETE', token });
      return r;
    } catch (e) {
      return { ok: false as const, message: e instanceof ApiError ? e.message : AUTH_MESSAGES.server };
    }
  }

  async createInvite(token: string | null) {
    try {
      return await api<{ code: string; expiresAt: number }>('/household/invites', { body: {}, token });
    } catch (e) {
      return { error: e instanceof ApiError ? e.error : 'server', message: e instanceof ApiError ? e.message : AUTH_MESSAGES.server };
    }
  }

  async forgetAll(): Promise<void> {
    this.modes.clear();
  }
}

/** Is this session still good? `null` = signed out (with why); throws ApiError on no connection. */
export async function checkSession(token: string): Promise<{ account: Account } | { signedOut: string }> {
  try {
    const r = await api<{ account: ServerAccount }>('/me', { token });
    return { account: toAccount(r.account) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { signedOut: e.message };
    throw e;
  }
}
