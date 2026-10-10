jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { MockAuthService } from '../src/services/MockAuthService';
import { LOCK_MS, MAX_ATTEMPTS, checkPasskey, formatPasskey, makePasskey, nameKey, passkeyKey, type Account } from '../src/state/auth';
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

/** A service with a hand-cranked clock; every passkey is AAAAAAAA. */
function setup() {
  let t = 1_000_000;
  const store = memoryStore();
  const svc = new MockAuthService(store, () => t, () => 0);
  return { svc, store, tick: (ms: number) => { t += ms; } };
}

const PHONE = '+919876543210';
const KEY = 'AAAA-AAAA';

async function join(svc: MockAuthService, name = 'Lakshmi', phone = PHONE) {
  const r = await svc.requestAccess({ name, phone });
  if (!r.ok) throw new Error(r.error);
  return svc.signInWithPasskey({ name, phone, passkey: r.sandboxPasskey! });
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
  const rec = { name: 'Lakshmi Rao', passkey: 'K7M4PX9Q', attemptsLeft: MAX_ATTEMPTS };

  it('names match ignoring case and spaces', () => expect(nameKey('  lakshmi  RAO')).toBe(nameKey('LakshmiRao')));

  it('passkeys ignore case, spaces and the dash, and show as XXXX-XXXX', () => {
    expect(passkeyKey(' k7m4 - px9q ')).toBe('K7M4PX9Q');
    expect(formatPasskey('k7m4px9q')).toBe('K7M4-PX9Q');
    expect(formatPasskey('k7m')).toBe('K7M');
    expect(formatPasskey('K7M4-PX9QZZZ')).toBe('K7M4-PX9Q');
  });

  it('makes passkeys without look-alike characters', () => {
    const k = makePasskey(() => 0.999);
    expect(k).toHaveLength(8);
    expect(k).not.toMatch(/[01OIL]/);
  });

  it.each([
    ['right name and passkey', rec, undefined, 'lakshmirao', 'k7m4-px9q', true],
    ['account name wins over the asked-with name', rec, 'Lakshmi', 'lakshmi', 'K7M4PX9Q', true],
    ['wrong passkey', rec, undefined, 'Lakshmi Rao', 'K7M4PX9R', false],
    ['wrong name', rec, undefined, 'Ravi', 'K7M4PX9Q', false],
    ['no passkey issued', undefined, undefined, 'Lakshmi Rao', 'K7M4PX9Q', false],
  ] as const)('%s', (_label, record, accountName, name, passkey, ok) => {
    const r = checkPasskey(record, accountName, name, passkey, 0);
    expect(r.ok).toBe(ok);
    if (!r.ok) expect(r.error).toBe('wrong_details');  // never says which part was wrong
  });

  it('locks after too many wrong tries, then counts afresh', () => {
    let r = checkPasskey(rec, undefined, 'Lakshmi Rao', 'NOPE', 0);
    let record = rec;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(r).toMatchObject({ ok: false, error: 'wrong_details' });
      record = (r as { record: typeof rec }).record;
      r = checkPasskey(record, undefined, 'Lakshmi Rao', 'NOPE', 0);
    }
    expect(r).toMatchObject({ ok: false, error: 'locked', lockedUntil: LOCK_MS });
    const locked = { ...record, lockedUntil: LOCK_MS };
    expect(checkPasskey(locked, undefined, 'Lakshmi Rao', 'K7M4PX9Q', LOCK_MS - 1)).toMatchObject({ error: 'locked' });
    expect(checkPasskey(locked, undefined, 'Lakshmi Rao', 'K7M4PX9Q', LOCK_MS).ok).toBe(true);
    expect(checkPasskey(locked, undefined, 'Lakshmi Rao', 'NOPE', LOCK_MS))
      .toMatchObject({ error: 'wrong_details', record: { attemptsLeft: MAX_ATTEMPTS - 1 } });
  });
});

describe('MockAuthService', () => {
  it('name and number issue a passkey; the passkey signs in, first as new then as returning', async () => {
    const { svc, store } = setup();
    expect(await svc.requestAccess({ name: '  Lakshmi ', phone: PHONE })).toMatchObject({ ok: true, sandboxPasskey: 'AAAAAAAA' });
    expect(store.data.get('hearth_accounts_v1')).toBeUndefined();  // no account until the passkey is used
    expect(await svc.signInWithPasskey({ name: 'lakshmi', phone: PHONE, passkey: KEY }))
      .toMatchObject({ ok: true, created: true, account: { name: 'Lakshmi', phone: PHONE } });
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: 'aaaaaaaa' }))
      .toMatchObject({ ok: true, created: false });
  });

  it('asking again keeps the same passkey', async () => {
    const { svc } = setup();
    await join(svc);
    const again = await svc.requestAccess({ name: 'Lakshmi', phone: PHONE });
    expect(again).toMatchObject({ ok: true, sandboxPasskey: 'AAAAAAAA' });
  });

  it('a wrong name, passkey or unknown number all get the same answer', async () => {
    const { svc } = setup();
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: KEY })).toMatchObject({ error: 'wrong_details' });
    await join(svc);
    expect(await svc.signInWithPasskey({ name: 'Ravi', phone: PHONE, passkey: KEY })).toMatchObject({ error: 'wrong_details' });
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: 'BBBBBBBB' })).toMatchObject({ error: 'wrong_details' });
  });

  it('locks the number for 15 minutes after too many wrong tries', async () => {
    const { svc, tick } = setup();
    await svc.requestAccess({ name: 'Lakshmi', phone: PHONE });
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: 'BBBBBBBB' })).toMatchObject({ error: 'wrong_details' });
    }
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: 'BBBBBBBB' })).toMatchObject({ error: 'locked' });
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: KEY })).toMatchObject({ error: 'locked' });
    tick(LOCK_MS);
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: KEY })).toMatchObject({ ok: true });
  });

  it('needs a name', async () => {
    const { svc } = setup();
    expect(await svc.requestAccess({ name: ' ', phone: PHONE })).toMatchObject({ ok: false, error: 'invalid_name' });
  });

  it('forgetAll and delete clear accounts and passkeys', async () => {
    const { svc } = setup();
    const r = await join(svc);
    if (!r.ok) throw new Error(r.error);
    await svc.deleteAccount(r.account);
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: KEY })).toMatchObject({ error: 'wrong_details' });
    await join(svc);
    await svc.forgetAll();
    expect(await svc.signInWithPasskey({ name: 'Lakshmi', phone: PHONE, passkey: KEY })).toMatchObject({ error: 'wrong_details' });
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
