'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthResponse, LoginInput, RegisterInput } from '@zaa4eem/shared';
import { ApiError, api, apiFetch, getAccessToken, setAccessToken, setUnauthorizedHandler } from './api-client';
import { getTelegramWebApp, isTelegramLaunch, waitForTelegramInitData } from './telegram';

type CurrentUser = AuthResponse['user'] | null;

/**
 * A login that got past the password but still owes a second factor. The
 * caller is expected to collect a code and hand the ticket back — nothing
 * is signed in until then.
 */
export interface PendingTwoFactor {
  twoFactorRequired: true;
  ticket: string;
}

type LoginOutcome = PendingTwoFactor | null;

interface AuthContextValue {
  user: CurrentUser;
  loading: boolean;
  isTelegram: boolean;
  telegramAuthError: string | null;
  retryTelegramAuth: () => void;
  /** Resolves to a pending-2FA handle when the account has it on, otherwise null (signed in). */
  login: (input: LoginInput) => Promise<LoginOutcome>;
  register: (input: RegisterInput) => Promise<void>;
  /** Second step of a 2FA login: a TOTP code or one backup code. */
  submitTwoFactor: (ticket: string, code: string) => Promise<void>;
  /** Any endpoint that answers with a full session (passkey, magic link) lands here. */
  adoptSession: (res: AuthResponse) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * "This browser probably has a live session" flag.
 *
 * The refresh token lives in an httpOnly cookie scoped to the API's own
 * host, so this tab can't read it to find out whether restoring a session
 * is even worth a network call. Without a hint, every first-time visitor
 * paid for a /auth/refresh round-trip that was always going to 401.
 *
 * The flag is only ever an optimisation for *what to show first*: a
 * background refresh still runs either way, so a returning user whose
 * localStorage got cleared is picked up a moment later rather than being
 * wrongly treated as a guest forever.
 */
const SESSION_HINT_KEY = 'zaa4eem_session_hint';

function readSessionHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSessionHint(hasSession: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (hasSession) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Private mode / storage disabled — the background refresh still covers us.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser>(null);
  const [loading, setLoading] = useState(true);
  const [isTelegram, setIsTelegram] = useState(false);
  const [telegramAuthError, setTelegramAuthError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const applySession = useCallback((res: AuthResponse) => {
    setAccessToken(res.accessToken);
    setUser(res.user);
    setTelegramAuthError(null);
    writeSessionHint(true);
  }, []);

  // The access token is short-lived (15 min server-side) so `refresh` gets
  // called both on mount and, via setUnauthorizedHandler below, whenever any
  // API call hits a stale token mid-session. Two triggers can land at the
  // same moment (e.g. two components' data fetches both 401 at once, or
  // React StrictMode's dev-only double effect), and the refresh endpoint
  // *rotates* the cookie on every call — a second concurrent call would
  // present the just-replaced token and get rejected, logging the user out
  // for no real reason. Dedupe concurrent callers onto the one in-flight
  // request instead of letting each fire its own.
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const refresh = useCallback((): Promise<boolean> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const attempt = (async () => {
      try {
        const res = await api.post<{ accessToken: string }>('/auth/refresh');
        setAccessToken(res.accessToken);
        // Bypasses apiFetch's own 401-retry (passing isRetry=true) rather
        // than going through the public api.get wrapper: if this call ever
        // 401'd it would otherwise re-enter the unauthorized handler below
        // while refreshInFlight is still set to *this* promise, awaiting a
        // promise that can only resolve once this very call returns — a
        // guaranteed deadlock.
        const me = await apiFetch<CurrentUser>('/users/me', {}, true);
        setUser(me);
        writeSessionHint(true);
        return true;
      } catch {
        setAccessToken(null);
        setUser(null);
        writeSessionHint(false);
        return false;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = attempt;
    return attempt;
  }, []);

  // Registered once so api-client's apiFetch/apiUpload can silently recover
  // from a 401 (expired access token) by refreshing and retrying, instead of
  // the calling component just seeing a failed request.
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      const ok = await refresh();
      return ok && getAccessToken() !== null;
    });
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    async function loginWithTelegram() {
      setIsTelegram(true);
      getTelegramWebApp()?.ready();
      getTelegramWebApp()?.expand();

      const initData = await waitForTelegramInitData();
      if (cancelled) return false;
      if (!initData) return false;

      try {
        let res: AuthResponse;
        try {
          res = await api.post<AuthResponse>('/auth/telegram', { initData });
        } catch (err) {
          // A rejection the server actually returned (bad signature, stale
          // initData) won't succeed on retry with the same payload — only
          // retry a network-level failure, which is exactly what a brief
          // connectivity blip right as the WebView wakes from background
          // looks like (the scenario this is guarding against).
          if (err instanceof ApiError) throw err;
          await new Promise((resolve) => setTimeout(resolve, 800));
          if (cancelled) return false;
          res = await api.post<AuthResponse>('/auth/telegram', { initData });
        }
        if (cancelled) return false;
        applySession(res);
        return true;
      } catch (err) {
        if (cancelled) return false;
        console.error('Telegram auto-login failed:', err);
        setTelegramAuthError(
          err instanceof ApiError
            ? `Не удалось войти через Telegram: ${err.message}`
            : 'Не удалось войти через Telegram — проверь соединение и попробуй ещё раз.',
        );
        return false;
      }
    }

    async function bootstrap() {
      setTelegramAuthError(null);

      // Nothing below blocks the UI any more: the shell (AppChrome) renders
      // immediately and this only fills in who's logged in. `loading` now
      // means "we might still turn out to be signed in, don't show the
      // signed-out state yet" — so it's dropped the moment we know a guest
      // is a guest, instead of after a second of Telegram polling plus a
      // refresh round-trip that was always going to 401.
      if (isTelegramLaunch()) {
        await loginWithTelegram();
        if (!cancelled) setLoading(false);
        return;
      }

      if (!readSessionHint()) {
        // Certain enough to paint the signed-out UI right now. The refresh
        // below still runs — it just isn't allowed to hold up the paint —
        // so a returning visitor whose localStorage was cleared still gets
        // picked up a beat later rather than being stuck as a guest.
        setLoading(false);
        await refresh();
        return;
      }

      await refresh();
      if (!cancelled) setLoading(false);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  // Safety net for the one case the synchronous check can miss: a Telegram
  // client that neither leaves its launch parameters in the URL fragment nor
  // has the SDK ready by first paint. Costs a guest nothing — it only looks
  // again shortly after mount, and only while nobody is signed in.
  useEffect(() => {
    if (user || isTelegram) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || user || isTelegram) return;
      if (isTelegramLaunch()) setRetryTick((t) => t + 1);
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, isTelegram]);

  const retryTelegramAuth = useCallback(() => {
    setLoading(true);
    setRetryTick((t) => t + 1);
  }, []);

  // Drives the online/away/offline presence indicator (PresenceDot) — any
  // click/keypress/tap counts as activity, throttled to at most once/minute
  // so a busy session doesn't hammer the endpoint. lastSentAt is a ref (not
  // state) purely to survive this effect re-running without itself
  // triggering a re-run.
  const lastHeartbeatSentAt = useRef(0);
  useEffect(() => {
    if (!user) return;

    function sendHeartbeat() {
      const now = Date.now();
      if (now - lastHeartbeatSentAt.current < 60_000) return;
      lastHeartbeatSentAt.current = now;
      api.post('/users/me/heartbeat').catch(() => undefined);
    }

    sendHeartbeat();
    const events: Array<keyof WindowEventMap> = ['click', 'keydown', 'touchstart', 'scroll'];
    events.forEach((event) => window.addEventListener(event, sendHeartbeat, { passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, sendHeartbeat));
  }, [user]);

  const login = useCallback(
    async (input: LoginInput): Promise<LoginOutcome> => {
      const res = await api.post<AuthResponse | PendingTwoFactor>('/auth/login', input);
      if ('twoFactorRequired' in res) return res;
      applySession(res);
      return null;
    },
    [applySession],
  );

  const submitTwoFactor = useCallback(
    async (ticket: string, code: string) => {
      applySession(await api.post<AuthResponse>('/auth/2fa', { ticket, code }));
    },
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await api.post<AuthResponse>('/auth/register', input);
      applySession(res);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    writeSessionHint(false);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isTelegram,
      telegramAuthError,
      retryTelegramAuth,
      login,
      register,
      submitTwoFactor,
      adoptSession: applySession,
      logout,
      refresh,
    }),
    [
      user,
      loading,
      isTelegram,
      telegramAuthError,
      retryTelegramAuth,
      login,
      register,
      submitTwoFactor,
      applySession,
      logout,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
