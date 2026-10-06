jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { MockAuthService } from '../src/services/MockAuthService';
import { MAX_ATTEMPTS, OTP_TTL_MS, RESEND_AFTER_MS, checkRequest, clock, nameKey, type Account } from '../src/state/auth';
import { COUNTRIES, countryByCode, formatPhone, localDigits, splitE164, toE164 } from '../src/state/phone';
import { DEFAULT_PROFILE, linkAccount } from '../src/state/profile';

const IN = countryByCode('IN');
const US = countryByCode('US');
const AE = countryByCode('AE');

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => { data.set(k, v); },
    removeItem: async (k: string) => { data.delete(k); },
  };
}

/** A service with a hand-cranked clock; every code is 000000 unless a test overrides it. */
function setup() {
  let t = 1_000_000;
  const store = memoryStore();
  const svc = new MockAuthService(store, () => t, () => 0);
  return { svc, store, tick: (ms: number) => { t += ms; } };
}

const PHONE = '+919876543210';

async function signUp(svc: MockAuthService, name = 'Lakshmi', relation = 'Mom', phone = PHONE) {
  const r = await svc.requestOtp({ mode: 'sign_up', name, relation, phone });
  if (!r.ok) throw new Error(r.error);
  return svc.verifyOtp(phone, r.devCode!);
}

describe('phone', () => {
  it.each([
    [IN, '98765 43210', '+919876543210'],
    [IN, '+91 98765-43210', '+919876543210'],
    [IN, '098765 43210', '+919876543210'],
    [US, '(415) 555-0123', '+14155550123'],
    [US, '1 415 555 0123', '+14155550123'],
    [AE, '050 123 4567', '+971501234567'],
  ])('%#: %s → E.164', (country, input, out) => expect(toE164(country, input)).toBe(out));

  it('rejects numbers that are not mobiles for that country', () => {
    expect(toE164(IN, '1234567890')).toBe('invalid');
    expect(toE164(US, '98765')).toBe('invalid');
  });

  it('blank is null', () => expect(toE164(IN, ' ')).toBeNull());

  it('the field keeps digits only, up to the country length', () => {
    expect(localDigits(IN, '+91 98765 43210')).toBe('9876543210');
    expect(localDigits(COUNTRIES.find((x) => x.code === 'SG')!, '9123 45678')).toBe('91234567');
  });

  it('splits and formats E.164 back for display', () => {
    expect(splitE164('+14155550123')).toEqual({ country: US, local: '4155550123' });
    expect(splitE164(null).country).toBe(IN);
    expect(formatPhone(PHONE)).toBe('+91 98765 43210');
  });
});

describe('auth rules', () => {
  const acct: Account = { phone: PHONE, name: 'Lakshmi Rao', relation: 'Mom', createdAt: '' };

  it('names match ignoring case and spaces', () => expect(nameKey('  lakshmi  RAO')).toBe(nameKey('LakshmiRao')));

  it.each([
    ['sign_in', 'Lakshmi Rao', undefined, acct, null],
    ['sign_in', 'lakshmirao', undefined, acct, null],
    ['sign_in', 'Ravi', undefined, acct, 'name_mismatch'],
    ['sign_in', 'Lakshmi', undefined, undefined, 'no_account'],
    ['sign_in', '  ', undefined, acct, 'invalid_name'],
    ['sign_up', 'Lakshmi', 'Mom', undefined, null],
    ['sign_up', 'Lakshmi', 'Mom', acct, 'account_exists'],
    ['sign_up', 'Lakshmi', ' ', undefined, 'invalid_relation'],
  ] as const)('%s as %s → %s', (mode, name, relation, existing, error) => {
    expect(checkRequest(mode, name, relation, existing)).toBe(error);
  });

  it('formats countdowns', () => {
    expect(clock(24_000)).toBe('0:24');
    expect(clock(OTP_TTL_MS)).toBe('5:00');
    expect(clock(-5)).toBe('0:00');
  });
});

describe('MockAuthService', () => {
  it('signs up, then signs in with the same name and number', async () => {
    const { svc, store } = setup();
    const up = await signUp(svc, '  Lakshmi ', 'Mom');
    expect(up).toMatchObject({ ok: true, created: true, account: { name: 'Lakshmi', relation: 'Mom', phone: PHONE } });
    expect(JSON.parse(store.data.get('hearth_accounts_v1')!)[PHONE].name).toBe('Lakshmi');

    const r = await svc.requestOtp({ mode: 'sign_in', name: 'lakshmi', phone: PHONE });
    expect(r).toMatchObject({ ok: true, devCode: '000000' });
    expect(await svc.verifyOtp(PHONE, '000000')).toMatchObject({ ok: true, created: false, account: { name: 'Lakshmi' } });
  });

  it('only creates the account once the code is right', async () => {
    const { svc, store } = setup();
    await svc.requestOtp({ mode: 'sign_up', name: 'Lakshmi', relation: 'Mom', phone: PHONE });
    expect(store.data.size).toBe(0);
    expect(await svc.verifyOtp(PHONE, '123456')).toMatchObject({ ok: false, error: 'wrong_code', attemptsLeft: MAX_ATTEMPTS - 1 });
    expect(store.data.size).toBe(0);
  });

  it('refuses sign-in for an unknown number or the wrong name, before sending a code', async () => {
    const { svc } = setup();
    expect(await svc.requestOtp({ mode: 'sign_in', name: 'Lakshmi', phone: PHONE })).toMatchObject({ ok: false, error: 'no_account' });
    await signUp(svc);
    expect(await svc.requestOtp({ mode: 'sign_in', name: 'Ravi', phone: PHONE })).toMatchObject({ ok: false, error: 'name_mismatch' });
  });

  it('refuses a second sign-up on the same number', async () => {
    const { svc } = setup();
    await signUp(svc);
    expect(await svc.requestOtp({ mode: 'sign_up', name: 'Ravi', relation: 'Dad', phone: PHONE }))
      .toMatchObject({ ok: false, error: 'account_exists' });
  });

  it('makes you wait 30 s before resending, then issues a fresh code', async () => {
    const { svc, tick } = setup();
    await svc.requestOtp({ mode: 'sign_up', name: 'Lakshmi', relation: 'Mom', phone: PHONE });
    tick(RESEND_AFTER_MS - 1);
    expect(await svc.requestOtp({ mode: 'sign_up', name: 'Lakshmi', relation: 'Mom', phone: PHONE }))
      .toMatchObject({ ok: false, error: 'resend_too_soon' });
    tick(1);
    expect(await svc.requestOtp({ mode: 'sign_up', name: 'Lakshmi', relation: 'Mom', phone: PHONE })).toMatchObject({ ok: true });
  });

  it('expires a code after 5 minutes', async () => {
    const { svc, tick } = setup();
    await svc.requestOtp({ mode: 'sign_up', name: 'Lakshmi', relation: 'Mom', phone: PHONE });
    tick(OTP_TTL_MS);
    expect(await svc.verifyOtp(PHONE, '000000')).toMatchObject({ ok: false, error: 'expired' });
    expect(await svc.verifyOtp(PHONE, '000000')).toMatchObject({ ok: false, error: 'no_code' });
  });

  it('locks the code after too many wrong tries', async () => {
    const { svc } = setup();
    await svc.requestOtp({ mode: 'sign_up', name: 'Lakshmi', relation: 'Mom', phone: PHONE });
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(await svc.verifyOtp(PHONE, '999999')).toMatchObject({ error: 'wrong_code' });
    expect(await svc.verifyOtp(PHONE, '999999')).toMatchObject({ ok: false, error: 'too_many_attempts' });
    expect(await svc.verifyOtp(PHONE, '000000')).toMatchObject({ ok: false, error: 'no_code' });
  });

  it('forgetAll clears accounts', async () => {
    const { svc } = setup();
    await signUp(svc);
    await svc.forgetAll();
    expect(await svc.requestOtp({ mode: 'sign_in', name: 'Lakshmi', phone: PHONE })).toMatchObject({ ok: false, error: 'no_account' });
  });
});

describe('linkAccount', () => {
  const acct = (name: string, relation: string, phone = PHONE): Account => ({ name, relation, phone, createdAt: '' });

  it('before setup, takes over the sample member with the same relation', () => {
    const p = linkAccount(DEFAULT_PROFILE, acct('Priya', 'Mom'));
    expect(p.members).toHaveLength(DEFAULT_PROFILE.members.length);
    expect(p.members.find((m) => m.id === p.meId)).toMatchObject({ id: 'm_mom', name: 'Priya', phone: PHONE, on: true });
  });

  it('a new relation joins first, so setup lists you on top', () => {
    const p = linkAccount(DEFAULT_PROFILE, acct('Kamala', 'Grandma'));
    expect(p.members[0]).toMatchObject({ name: 'Kamala', relation: 'Grandma', phone: PHONE });
    expect(p.meId).toBe(p.members[0].id);
  });

  it('is idempotent and finds you by phone next time', () => {
    const once = linkAccount(DEFAULT_PROFILE, acct('Priya', 'Mom'));
    expect(linkAccount(once, acct('Priya', 'Mom'))).toBe(once);
  });

  it('keeps you after you change your family-facing number', () => {
    const linked = { ...linkAccount(DEFAULT_PROFILE, acct('Priya', 'Mom')), onboarded: true };
    const edited = { ...linked, members: linked.members.map((m) => (m.id === 'm_mom' ? { ...m, phone: '+919999999999' } : m)) };
    expect(linkAccount(edited, acct('Priya', 'Mom'))).toBe(edited);
  });

  it('after setup, someone new on this phone is added to the end', () => {
    const home = { ...linkAccount(DEFAULT_PROFILE, acct('Priya', 'Mom')), onboarded: true };
    const p = linkAccount(home, acct('Arjun', 'Son', '+919811112222'));
    expect(p.members.at(-1)).toMatchObject({ name: 'Arjun', phone: '+919811112222' });
    expect(p.meId).toBe(p.members.at(-1)!.id);
  });
});
