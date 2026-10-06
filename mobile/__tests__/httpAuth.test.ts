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

it('sends the home code and maps a refusal with its wait time', async () => {
  const { HttpAuthService } = load();
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(() =>
    reply(429, { error: 'resend_too_soon', message: 'Please wait a moment before asking for another code.', resend_after: 123 }));
  const r = await new HttpAuthService().requestOtp({ mode: 'sign_up', name: 'Ravi', phone: '+919811112222', relation: 'Dad', inviteCode: ' HRTH-4K9P ' });

  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/auth/code');
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).inviteCode).toBe('HRTH-4K9P');
  expect(r).toMatchObject({ ok: false, error: 'resend_too_soon', resendAt: 123 });
});

it('verifies with the mode the code was asked for and returns the token', async () => {
  const { HttpAuthService } = load();
  const account = { memberId: 'm_1', householdId: 'h_1', name: 'Ravi', relation: 'Dad', phone: '+919811112222', role: 'member', createdAt: '2026-10-06' };
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementationOnce(() => reply(200, { expiresAt: 1, resendAt: 1 }))
    .mockImplementationOnce(() => reply(200, { token: 'tok', created: true, account }));
  const auth = new HttpAuthService();
  await auth.requestOtp({ mode: 'sign_up', name: 'Ravi', phone: '+919811112222', relation: 'Dad' });
  const r = await auth.verifyOtp('+919811112222', '123456');

  expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).mode).toBe('sign_up');
  expect(r).toMatchObject({ ok: true, token: 'tok', created: true, account: { householdId: 'h_1', role: 'member' } });
});

it('no connection reads as a friendly network error', async () => {
  const { HttpAuthService } = load();
  jest.spyOn(globalThis, 'fetch' as any).mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
  const r = await new HttpAuthService().requestOtp({ mode: 'sign_in', name: 'Ravi', phone: '+919811112222' });
  expect(r).toMatchObject({ ok: false, error: 'network' });
});
