'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ProgressState } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface ProgressContextValue {
  state: ProgressState | null;
  /** Distinguishes "not loaded yet" from "loaded and there is nothing" — the navbar shows a skeleton for the first, nothing for the second. */
  loading: boolean;
  refresh: () => Promise<void>;
}

const ProgressContext = createContext<ProgressContextValue>({
  state: null,
  loading: false,
  refresh: async () => undefined,
});

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<ProgressState | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await api.get<ProgressState>('/progress'));
    } catch {
      // Offline, or a token mid-refresh — the next call picks it up.
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setState(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<ProgressState>('/progress')
      .then((value) => {
        if (!cancelled) setState(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <ProgressContext.Provider value={{ state, loading, refresh }}>{children}</ProgressContext.Provider>
  );
}

export function useProgress() {
  return useContext(ProgressContext);
}
