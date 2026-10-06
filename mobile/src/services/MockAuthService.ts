import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthService, OtpRequest, OtpRequestResult, VerifyResult } from './AuthService';
import {
  AUTH_MESSAGES, MAX_ATTEMPTS, OTP_TTL_MS, RESEND_AFTER_MS, checkCode, checkRequest, cleanName, makeCode,
  type Account, type AuthError, type PendingOtp,
} from '../state/auth';

const KEY = 'hearth_accounts_v1';

interface Store {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const fail = (error: AuthError, extra: object = {}) => ({ ok: false as const, error, message: AUTH_MESSAGES[error], ...extra });

/**
 * Sandbox sign-in: accounts live on this phone, and the "SMS" code comes back
 * as `devCode` for the screen to show. Pending codes are in memory only, like
 * a server's — restarting the app means asking for a new one.
 */
export class MockAuthService implements AuthService {
  private pending = new Map<string, PendingOtp>();

  constructor(
    private store: Store = AsyncStorage,
    private now: () => number = Date.now,
    private random: () => number = Math.random,
  ) {}

  private async accounts(): Promise<Record<string, Account>> {
    try {
      const raw = await this.store.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async requestOtp(req: OtpRequest): Promise<OtpRequestResult> {
    const accounts = await this.accounts();
    const error = checkRequest(req.mode, req.name, req.relation, accounts[req.phone]);
    if (error) return fail(error);

    const now = this.now();
    const prev = this.pending.get(req.phone);
    if (prev && prev.mode === req.mode && now < prev.resendAt) return fail('resend_too_soon', { resendAt: prev.resendAt });

    const code = makeCode(this.random);
    const pending: PendingOtp = {
      mode: req.mode,
      phone: req.phone,
      code,
      expiresAt: now + OTP_TTL_MS,
      resendAt: now + RESEND_AFTER_MS,
      attemptsLeft: MAX_ATTEMPTS,
      draft: req.mode === 'sign_up'
        ? { phone: req.phone, name: cleanName(req.name), relation: cleanName(req.relation ?? '') }
        : undefined,
    };
    this.pending.set(req.phone, pending);
    return { ok: true, expiresAt: pending.expiresAt, resendAt: pending.resendAt, devCode: code };
  }

  async verifyOtp(phone: string, code: string): Promise<VerifyResult> {
    const pending = this.pending.get(phone);
    const result = checkCode(pending, code, this.now());
    if (!result.ok) {
      if (result.error === 'wrong_code') {
        this.pending.set(phone, result.pending);
        return fail('wrong_code', { attemptsLeft: result.pending.attemptsLeft });
      }
      if (result.error !== 'no_code') this.pending.delete(phone);
      return fail(result.error);
    }
    this.pending.delete(phone);

    const accounts = await this.accounts();
    if (pending!.mode === 'sign_in') {
      const account = accounts[phone];
      return account ? { ok: true, account, created: false } : fail('no_account');
    }
    // Someone else may have signed this number up while the code was out.
    if (accounts[phone]) return fail('account_exists');
    const account: Account = { ...pending!.draft!, createdAt: new Date(this.now()).toISOString() };
    await this.store.setItem(KEY, JSON.stringify({ ...accounts, [phone]: account }));
    return { ok: true, account, created: true };
  }

  async signOut(): Promise<void> {}

  async deleteAccount(account: Account): Promise<{ ok: true; householdDeleted: boolean }> {
    const { [account.phone]: _gone, ...rest } = await this.accounts();
    await this.store.setItem(KEY, JSON.stringify(rest));
    return { ok: true, householdDeleted: Object.keys(rest).length === 0 };
  }

  async createInvite(): Promise<null> {
    return null;
  }

  async forgetAll(): Promise<void> {
    this.pending.clear();
    await this.store.removeItem(KEY).catch(() => {});
  }
}
