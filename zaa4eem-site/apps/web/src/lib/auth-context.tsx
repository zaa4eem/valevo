'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthResponse, LoginInput, RegisterInput } from '@zaa4eem/shared';
import { ApiError, api, apiFetch, getAccessToken, setAccessToken, setUnauthorizedHandler } from './api-client';
import { getTelegramWebApp } from './telegram';

type CurrentUser = AuthResponse['user'] | null;

interface AuthContextValue {
  user: CurrentUser;
  loading: boolean;
  isTelegram: boolean;
  telegramAuthError: string | null;
  retryTelegramAuth: () => void;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Telegram injects window.Telegram.WebApp synchronously when the page is
// opened as a real Mini App, but `initData` itself can be empty for a brief
// moment on some clients before Telegram finishes populating it — poll a
// few times before concluding we're not inside Telegram at all.
async function waitForInitData(maxAttempts = 5, delayMs = 200): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const initData = getTelegramWebApp()?.initData;
    if (initData) return initData;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
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
        return true;
      } catch {
        setAccessToken(null);
        setUser(null);
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
    const telegram = getTelegramWebApp();
    if (telegram) {
      telegram.ready();
      telegram.expand();
    }

    let cancelled = false;

    async function bootstrap() {
      setTelegramAuthError(null);

      // window.Telegram.WebApp existing at all (even with initData still
      // empty) is the real "are we inside Telegram" signal — checking
      // initData alone raced against Telegram populating it.
      if (getTelegramWebApp()) {
        setIsTelegram(true);
        const initData = await waitForInitData();
        if (cancelled) return;

        if (!initData) {
          setTelegramAuthError(
            'Telegram не передал данные для входа. Попробуй закрыть и снова открыть мини-приложение.',
          );
          setLoading(false);
          return;
        }

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
            if (cancelled) return;
            res = await api.post<AuthResponse>('/auth/telegram', { initData });
          }
          if (cancelled) return;
          applySession(res);
        } catch (err) {
          if (cancelled) return;
          console.error('Telegram auto-login failed:', err);
          setTelegramAuthError(
            err instanceof ApiError
              ? `Не удалось войти через Telegram: ${err.message}`
              : 'Не удалось войти через Telegram — проверь соединение и попробуй ещё раз.',
          );
        }
      } else {
        await refresh();
      }
      if (!cancelled) setLoading(false);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  const retryTelegramAuth = useCallback(() => {
    setLoading(true);
    setRetryTick((t) => t + 1);
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await api.post<AuthResponse>('/auth/login', input);
      applySession(res);
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
  }, []);

  const value = useMemo(
    () => ({ user, loading, isTelegram, telegramAuthError, retryTelegramAuth, login, register, logout, refresh }),
    [user, loading, isTelegram, telegramAuthError, retryTelegramAuth, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
