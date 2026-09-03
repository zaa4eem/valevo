'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResponse, LoginInput, RegisterInput } from '@zaa4eem/shared';
import { ApiError, api, setAccessToken } from './api-client';
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
  refresh: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    try {
      const res = await api.post<{ accessToken: string }>('/auth/refresh');
      setAccessToken(res.accessToken);
      const me = await api.get<CurrentUser>('/users/me');
      setUser(me);
    } catch {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

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
          const res = await api.post<AuthResponse>('/auth/telegram', { initData });
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
