'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { ThemeToggle } from './ThemeToggle';

/**
 * Telegram's WebView is just a regular viewport — it doesn't provide its
 * own in-app navigation between sections, so the Navbar stays visible
 * there too (previously hidden, which left the Mini App with no way to
 * move between Feed/Ideas/Games/Leaderboard at all).
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

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
      <main className="z-container" style={{ paddingTop: 24, paddingBottom: 48, flex: 1 }}>
        {children}
      </main>
      <Footer />
      <ThemeToggle />
    </div>
  );
}
