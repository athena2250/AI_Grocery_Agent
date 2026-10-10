import { Platform } from 'react-native';
import type { AccessRequest, AccessRequestResult, AuthService, PasskeySignIn, SignInResult } from './AuthService';
import { AUTH_MESSAGES, passkeyKey, type Account, type AuthError } from '../state/auth';
import { ApiError, api } from './api';

interface ServerAccount {
  memberId: string; householdId: string; name: string; relation: string;
  phone: string; role: 'owner' | 'member'; createdAt: string;
}

const toAccount = (a: ServerAccount): Account => ({
  phone: a.phone, name: a.name, relation: a.relation, createdAt: a.createdAt,
  memberId: a.memberId, householdId: a.householdId, role: a.role,
});

function fail(e: unknown) {
  const err = e instanceof ApiError ? e : new ApiError(0, 'server', AUTH_MESSAGES.server);
  const error = (err.error in AUTH_MESSAGES ? err.error : 'server') as AuthError;
  return { ok: false as const, error, message: err.message || AUTH_MESSAGES[error] };
}

const deviceLabel = () => (Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : Platform.OS);

/** Real sign-in against the server (backend `/auth/*`): the admin issues passkeys from the dashboard. */
export class HttpAuthService implements AuthService {
  async requestAccess(req: AccessRequest): Promise<AccessRequestResult> {
    try {
      await api('/auth/request', { body: { name: req.name, phone: req.phone } });
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async signInWithPasskey(req: PasskeySignIn): Promise<SignInResult> {
    try {
      const r = await api<{ token: string; created: boolean; account: ServerAccount }>('/auth/passkey', {
        body: { name: req.name, phone: req.phone, passkey: passkeyKey(req.passkey), deviceLabel: deviceLabel() },
      });
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

  async forgetAll(): Promise<void> {}
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
