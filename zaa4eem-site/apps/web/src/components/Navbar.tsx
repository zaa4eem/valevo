'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ClickerState } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { PremiumAvatar } from './PremiumAvatar';
import { PremiumName } from './PremiumName';
import { NotificationBell } from './NotificationBell';
import { LevelStreakBadge } from './LevelStreakBadge';

// The clicker is one of the games listed under /games, not a top-level tab —
// and Зал славы lives in the profile menu below, one click away, instead of
// crowding this always-visible row.
const links = [
  { href: '/', label: 'Лента' },
  { href: '/ideas', label: 'Идеи' },
  { href: '/games', label: 'Игры' },
  { href: '/shop', label: 'Магазин' },
  { href: '/leaderboard', label: 'Лидеры' },
];

/** Polls the Z-Кликер balance so it's visible from anywhere on the site, not just on the clicker's own page — refreshed periodically since it changes outside of any single-page state (clicking, Shop purchases). */
function useZCoinsBalance(enabled: boolean) {
  const [zCoins, setZCoins] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setZCoins(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const state = await api.get<ClickerState>('/clicker/state');
        if (!cancelled) setZCoins(state.zCoins);
      } catch {
        // Non-fatal — the balance just doesn't render this tick.
      }
    }
    load();
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return zCoins;
}

function ZCoinsBadge({ zCoins }: { zCoins: number | null }) {
  if (zCoins === null) return null;
  return (
    <Link href="/games/z-clicker" className="z-navbar-zcoins z-pop-on-active" title="Z-Кликер">
      🪙 {zCoins}
    </Link>
  );
}

/** The one profile control, identical on desktop and mobile: avatar → a dropdown with everything account-related, so nothing account-related needs its own slot in the always-visible bar. */
function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (!user) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="z-pop-on-active"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}
        aria-label="Меню профиля"
      >
        <PremiumAvatar name={user.displayName} avatarUrl={user.avatarUrl} size={36} premium={user} />
      </button>
      {open && (
        <div className="z-navbar-menu z-animate-fade">
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--z-border)', fontWeight: 700 }}>
            <PremiumName name={user.displayName} premium={user} />
          </div>
          <Link href={`/u/${user.id}`} className="z-navbar-menu-item" onClick={() => setOpen(false)}>
            👤 Профиль
          </Link>
          <Link href="/settings" className="z-navbar-menu-item" onClick={() => setOpen(false)}>
            ⚙️ Настройки
          </Link>
          <Link href="/progress" className="z-navbar-menu-item" onClick={() => setOpen(false)}>
            🎯 Прогресс
          </Link>
          <Link href="/achievements" className="z-navbar-menu-item" onClick={() => setOpen(false)}>
            🏅 Достижения
          </Link>
          <Link href="/notifications" className="z-navbar-menu-item" onClick={() => setOpen(false)}>
            🔔 Уведомления
          </Link>
          <Link href="/hall-of-fame" className="z-navbar-menu-item" onClick={() => setOpen(false)}>
            💡 Зал славы
          </Link>
          {user.role === 'OWNER' && (
            <Link
              href="/admin"
              className="z-navbar-menu-item"
              style={{ color: 'var(--z-accent)' }}
              onClick={() => setOpen(false)}
            >
              🛠️ Admin
            </Link>
          )}
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="z-navbar-menu-item"
            style={{ color: 'var(--z-danger)', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            🚪 Выйти
          </button>
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const { user, loading } = useAuth();
  const zCoins = useZCoinsBalance(Boolean(user));

  return (
    <header
      style={{
        borderBottom: '1px solid var(--z-border)',
        position: 'sticky',
        top: 0,
        background: 'var(--z-navbar-bg)',
        backdropFilter: 'blur(6px)',
        zIndex: 10,
      }}
    >
      <div
        className="z-container"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60, gap: 12 }}
      >
        <Link href="/" style={{ fontWeight: 900, fontSize: 'var(--z-fs-lg)', letterSpacing: 1, flexShrink: 0 }}>
          ZAA<span className="z-accent-text">4</span>EEM
        </Link>

        {/* Section tabs — desktop only. Mobile gets the same set as BottomNav's fixed tab bar instead. */}
        <nav className="z-navbar-links z-navbar-desktop-only" style={{ minWidth: 0 }}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Account cluster — one visual group, same on every breakpoint: search (desktop; mobile has it as a bottom tab), Z-coins balance, profile menu. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Link
            href="/search"
            className="z-btn-ghost z-pop-on-active z-navbar-desktop-only"
            title="Поиск"
            aria-label="Поиск"
            style={{ padding: '6px 10px' }}
          >
            🔍
          </Link>
          {user ? (
            <>
              <LevelStreakBadge />
              <ZCoinsBadge zCoins={zCoins} />
              <NotificationBell />
              <UserMenu />
            </>
          ) : loading ? (
            // Session restore is still in flight and this browser has been
            // signed in before — showing "Войти" here would flash the wrong
            // state at a returning user for a fraction of a second. A guest
            // never lands here: `loading` drops synchronously for anyone
            // without a session hint (see auth-context).
            <span
              aria-hidden
              className="z-skeleton"
              style={{ width: 36, height: 36, borderRadius: '50%' }}
            />
          ) : (
            <Link href="/login" className="z-btn-accent">
              Войти
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
