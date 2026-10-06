/**
 * The Hearth server. Set EXPO_PUBLIC_API_URL (eas.json per build profile, or
 * `.env` for `expo start`) to switch the app from on-phone sandbox mode to
 * real sign-in + family sharing. Unset → everything stays on this phone.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export const isOnline = (): boolean => API_URL.length > 0;

/** The signed-in session's token (AuthContext keeps it current), for services outside React. */
let sessionToken: string | null = null;
export const setSessionToken = (t: string | null) => { sessionToken = t; };
export const getSessionToken = () => sessionToken;

export class ApiError extends Error {
  constructor(
    public status: number,
    public error: string,
    message: string,
    public detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'network', 'No connection. Check the internet and try again.');
  } finally {
    clearTimeout(timer);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, message, ...detail } = data ?? {};
    throw new ApiError(res.status, error ?? 'server', message ?? 'Something went wrong. Please try again.', detail);
  }
  return data as T;
}
