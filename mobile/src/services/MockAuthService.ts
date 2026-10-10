import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccessRequest, AccessRequestResult, AuthService, PasskeySignIn, SignInResult } from './AuthService';
import {
  AUTH_MESSAGES, MAX_ATTEMPTS, checkPasskey, cleanName, makePasskey, passkeyKey,
  type Account, type AuthError, type PasskeyRecord,
} from '../state/auth';

const KEY = 'hearth_accounts_v1';
const PASSKEYS = 'hearth_passkeys_v1';

interface Store {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const fail = (error: AuthError) => ({ ok: false as const, error, message: AUTH_MESSAGES[error] });

/**
 * Sandbox sign-in: accounts and passkeys live on this phone. There is no admin,
 * so asking with a name and number issues the passkey at once and hands it back
 * as `sandboxPasskey` for the screen to show.
 */
export class MockAuthService implements AuthService {
  constructor(
    private store: Store = AsyncStorage,
    private now: () => number = Date.now,
    private random: () => number = Math.random,
  ) {}

  private async read<T>(key: string): Promise<Record<string, T>> {
    try {
      const raw = await this.store.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async savePasskey(phone: string, record: PasskeyRecord): Promise<void> {
    const all = await this.read<PasskeyRecord>(PASSKEYS);
    await this.store.setItem(PASSKEYS, JSON.stringify({ ...all, [phone]: record }));
  }

  async requestAccess(req: AccessRequest): Promise<AccessRequestResult> {
    if (!cleanName(req.name)) return fail('invalid_name');
    const existing = (await this.read<PasskeyRecord>(PASSKEYS))[req.phone];
    if (existing) return { ok: true, sandboxPasskey: existing.passkey };
    const record: PasskeyRecord = { name: cleanName(req.name), passkey: makePasskey(this.random), attemptsLeft: MAX_ATTEMPTS };
    await this.savePasskey(req.phone, record);
    return { ok: true, sandboxPasskey: record.passkey };
  }

  async signInWithPasskey(req: PasskeySignIn): Promise<SignInResult> {
    if (!cleanName(req.name)) return fail('invalid_name');
    if (!passkeyKey(req.passkey)) return fail('invalid_passkey');
    const record = (await this.read<PasskeyRecord>(PASSKEYS))[req.phone];
    const accounts = await this.read<Account>(KEY);
    const existing = accounts[req.phone];
    const result = checkPasskey(record, existing?.name, req.name, req.passkey, this.now());
    if (!result.ok) {
      if (result.error === 'locked' && record) await this.savePasskey(req.phone, { ...record, lockedUntil: result.lockedUntil });
      if (result.error === 'wrong_details' && result.record) await this.savePasskey(req.phone, result.record);
      return fail(result.error);
    }
    await this.savePasskey(req.phone, { ...record!, attemptsLeft: MAX_ATTEMPTS, lockedUntil: undefined });
    if (existing) return { ok: true, account: existing, created: false };
    const account: Account = {
      phone: req.phone, name: record!.name, relation: 'Family', createdAt: new Date(this.now()).toISOString(),
    };
    await this.store.setItem(KEY, JSON.stringify({ ...accounts, [req.phone]: account }));
    return { ok: true, account, created: true };
  }

  async signOut(): Promise<void> {}

  async deleteAccount(account: Account): Promise<{ ok: true; householdDeleted: boolean }> {
    const { [account.phone]: _gone, ...rest } = await this.read<Account>(KEY);
    const { [account.phone]: _key, ...keys } = await this.read<PasskeyRecord>(PASSKEYS);
    await this.store.setItem(KEY, JSON.stringify(rest));
    await this.store.setItem(PASSKEYS, JSON.stringify(keys));
    return { ok: true, householdDeleted: Object.keys(rest).length === 0 };
  }

  async forgetAll(): Promise<void> {
    await this.store.removeItem(KEY).catch(() => {});
    await this.store.removeItem(PASSKEYS).catch(() => {});
  }
}
