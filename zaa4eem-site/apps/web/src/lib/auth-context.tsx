'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResponse, LoginInput, RegisterInput } from '@zaa4eem/shared';
import { api, setAccessToken } from './api-client';
import { getInitData, getTelegramWebApp, isTelegramRuntime } from './telegram';

type CurrentUser = AuthResponse['user'] | null;

interface AuthContextValue {
  user: CurrentUser;
  loading: boolean;
  isTelegram: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser>(null);
  const [loading, setLoading] = useState(true);
  const [isTelegram, setIsTelegram] = useState(false);

  const applySession = useCallback((res: AuthResponse) => {
    setAccessToken(res.accessToken);
    setUser(res.user);
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

    async function bootstrap() {
      if (isTelegramRuntime()) {
        setIsTelegram(true);
        const initData = getInitData();
        if (initData) {
          try {
            const res = await api.post<AuthResponse>('/auth/telegram', { initData });
            applySession(res);
          } catch {
            // Falls through to logged-out state; user can retry via the login page.
          }
        }
      } else {
        await refresh();
      }
      setLoading(false);
    }

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    () => ({ user, loading, isTelegram, login, register, logout, refresh }),
    [user, loading, isTelegram, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
