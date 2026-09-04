'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { ThemeToggle } from './ThemeToggle';
import { BottomNav } from './BottomNav';

/**
 * Telegram's WebView is just a regular viewport — it doesn't provide its
 * own in-app navigation between sections, so the Navbar stays visible
 * there too (previously hidden, which left the Mini App with no way to
 * move between Feed/Ideas/Games/Leaderboard at all).
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const { loading, isTelegram, telegramAuthError, user, retryTelegramAuth } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <span style={{ color: 'var(--z-text-muted)' }}>Загрузка…</span>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />
      {isTelegram && !user && telegramAuthError && (
        <div
          className="z-animate-fade"
          style={{
            background: 'var(--z-danger)',
            color: '#fff',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 'var(--z-fs-sm)',
            textAlign: 'center',
          }}
        >
          <span>{telegramAuthError}</span>
          <button
            onClick={retryTelegramAuth}
            className="z-pop-on-active"
            style={{
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 'var(--z-radius-sm)',
              padding: '4px 12px',
              fontSize: 'var(--z-fs-xs)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Повторить
          </button>
        </div>
      )}
      <main className="z-container z-main-content" style={{ paddingTop: 24, paddingBottom: 48, flex: 1, minWidth: 0, width: '100%' }}>
        {children}
      </main>
      <Footer />
      <ThemeToggle />
      <BottomNav />
    </div>
  );
}
