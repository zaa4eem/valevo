const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

let inMemoryAccessToken: string | null = null;

/** Lets auth-context stash the current access token for requests that can't rely on cookies alone (Telegram WebView). */
export function setAccessToken(token: string | null) {
  inMemoryAccessToken = token;
  if (typeof window !== 'undefined') {
    if (token) sessionStorage.setItem('zaa4eem_access_token', token);
    else sessionStorage.removeItem('zaa4eem_access_token');
  }
}

export function getAccessToken(): string | null {
  if (inMemoryAccessToken) return inMemoryAccessToken;
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('zaa4eem_access_token');
  }
  return null;
}

// The access token is short-lived (15 min) by design — auth-context registers
// a handler here (avoiding a direct import, which would create a cycle) that
// calls POST /auth/refresh and reports whether it got a new token. Every
// caller of apiFetch/apiUpload then silently recovers from an expired token
// instead of surfacing it as "you got logged out" after sitting on a page
// for a while.
type UnauthorizedHandler = () => Promise<boolean>;
let onUnauthorized: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

// /auth/refresh itself must never trigger the retry dance below — a 401 from
// it means the session is genuinely gone, and recursing into onUnauthorized
// (which calls refresh again) would loop forever.
const REFRESH_PATH = '/auth/refresh';

export async function apiFetch<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !isRetry && path !== REFRESH_PATH && onUnauthorized) {
    const refreshed = await onUnauthorized();
    if (refreshed) return apiFetch<T>(path, options, true);
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? res.statusText);
  }
  return data as T;
}

/** For multipart uploads — the browser sets its own Content-Type (with boundary), so it must not be set manually. */
export async function apiUpload<T>(path: string, form: FormData, isRetry = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  if (res.status === 401 && !isRetry && onUnauthorized) {
    const refreshed = await onUnauthorized();
    if (refreshed) return apiUpload<T>(path, form, true);
  }

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: apiUpload,
};
