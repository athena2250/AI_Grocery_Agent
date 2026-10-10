/** HttpAuthService: server answers → the shapes the AuthScreen already handles. */

const reply = (status: number, body: object) =>
  Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) } as Response);

function load() {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test/';
  let mod: typeof import('../src/services/HttpAuthService');
  jest.isolateModules(() => { mod = require('../src/services/HttpAuthService'); });
  return mod!;
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  jest.restoreAllMocks();
});

it('asking with name and number posts them and never gets a passkey back', async () => {
  const { HttpAuthService } = load();
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(() => reply(200, {}));
  const r = await new HttpAuthService().requestAccess({ name: 'Ravi', phone: '+919811112222' });

  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/auth/request');
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ name: 'Ravi', phone: '+919811112222' });
  expect(r).toEqual({ ok: true });
});

it('signs in with the passkey (dash removed) and returns the token', async () => {
  const { HttpAuthService } = load();
  const account = { memberId: 'm_1', householdId: 'h_1', name: 'Ravi', relation: 'Dad', phone: '+919811112222', role: 'member', createdAt: '2026-10-06' };
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(() => reply(200, { token: 'tok', created: true, account }));
  const r = await new HttpAuthService().signInWithPasskey({ name: 'Ravi', phone: '+919811112222', passkey: 'k7m4-px9q' });

  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/auth/passkey');
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ passkey: 'K7M4PX9Q' });
  expect(r).toMatchObject({ ok: true, token: 'tok', created: true, account: { householdId: 'h_1', role: 'member' } });
});

it('maps a refusal to its friendly message', async () => {
  const { HttpAuthService } = load();
  jest.spyOn(globalThis, 'fetch' as any).mockImplementation(() =>
    reply(400, { error: 'wrong_details', message: 'Those details don’t match. Check your name, number and passkey.' }));
  const r = await new HttpAuthService().signInWithPasskey({ name: 'Ravi', phone: '+919811112222', passkey: 'K7M4PX9Q' });
  expect(r).toMatchObject({ ok: false, error: 'wrong_details' });
});

it('no connection reads as a friendly network error', async () => {
  const { HttpAuthService } = load();
  jest.spyOn(globalThis, 'fetch' as any).mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
  const r = await new HttpAuthService().requestAccess({ name: 'Ravi', phone: '+919811112222' });
  expect(r).toMatchObject({ ok: false, error: 'network' });
});
