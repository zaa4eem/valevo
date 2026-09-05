'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { UnreadCount } from '@zaa4eem/shared';
import { api, getApiBase } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface NotificationsContextValue {
  unreadCount: number;
  /** True while a live SSE connection is up — the bell shows a subtle dot when it isn't. */
  live: boolean;
  /** Re-reads the count from the API; used after actions that change it outside this tab. */
  refresh: () => Promise<void>;
  /** Local, immediate adjustment so the badge reacts before the round trip finishes. */
  setUnreadCount: (count: number) => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  live: false,
  refresh: async () => undefined,
  setUnreadCount: () => undefined,
});

/** Backstop for anything the stream misses (a dropped connection, a tab asleep). */
const POLL_MS = 60_000;
/** A ticket lives 60s, so reconnects have to re-issue one; back off so a dead API isn't hammered. */
const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [live, setLive] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<UnreadCount>('/notifications/unread-count');
      setUnreadCount(res.unreadCount);
    } catch {
      // Offline or a token still refreshing — the next poll picks it up.
    }
  }, []);

  // Poll: cheap, and the only thing that runs when EventSource is unavailable
  // (older WebViews) or the stream silently died behind a proxy.
  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, refresh]);

  // Live stream. EventSource can't carry an Authorization header, so the
  // access token is traded for a single-purpose 60-second ticket first.
  useEffect(() => {
    if (!user || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setLive(false);
      return;
    }

    let cancelled = false;
    let retryDelay = RECONNECT_MIN_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (cancelled) return;
      let ticket: string;
      try {
        const res = await api.post<{ ticket: string }>('/notifications/stream-ticket');
        ticket = res.ticket;
      } catch {
        scheduleRetry();
        return;
      }
      if (cancelled) return;

      const source = new EventSource(
        `${getApiBase()}/notifications/stream?ticket=${encodeURIComponent(ticket)}`,
        { withCredentials: true },
      );
      sourceRef.current = source;

      source.onopen = () => {
        if (cancelled) return;
        setLive(true);
        retryDelay = RECONNECT_MIN_MS;
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { unreadCount?: number; ping?: boolean };
          if (typeof payload.unreadCount === 'number') setUnreadCount(payload.unreadCount);
        } catch {
          // A frame we don't understand is not worth tearing the stream down for.
        }
      };

      source.onerror = () => {
        // EventSource retries by itself, but it would replay the same expired
        // ticket forever — so close it and come back with a fresh one.
        source.close();
        sourceRef.current = null;
        setLive(false);
        scheduleRetry();
      };
    }

    function scheduleRetry() {
      if (cancelled) return;
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      sourceRef.current?.close();
      sourceRef.current = null;
      setLive(false);
    };
  }, [user]);

  return (
    <NotificationsContext.Provider value={{ unreadCount, live, refresh, setUnreadCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
