'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Navbar } from './Navbar';

/**
 * Hides the normal website navbar when running inside the Telegram Mini
 * App — Telegram provides its own chrome (back button, theming) per
 * research.md §1 / Constitution Principle III.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const { isTelegram, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <span style={{ color: 'var(--z-text-muted)' }}>Загрузка…</span>
      </div>
    );
  }

  return (
    <>
      {!isTelegram && <Navbar />}
      <main className={isTelegram ? '' : 'z-container'} style={{ paddingTop: isTelegram ? 12 : 24, paddingBottom: 48 }}>
        {children}
      </main>
    </>
  );
}
