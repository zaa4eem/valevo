'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ClickerState } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { PremiumAvatar } from './PremiumAvatar';
import { PremiumName } from './PremiumName';

const links = [
  { href: '/', label: 'Лента' },
  { href: '/ideas', label: 'Идеи' },
  { href: '/games', label: 'Игры' },
  { href: '/games/z-clicker', label: '🪙 Кликер' },
  { href: '/shop', label: '🛒 Магазин' },
  { href: '/leaderboard', label: 'Лидеры' },
  { href: '/hall-of-fame', label: '💡 Зал славы' },
  { href: '/search', label: '🔍 Поиск' },
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
    <Link
      href="/games/z-clicker"
      className="z-pop-on-active"
      title="Z-Кликер"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 'var(--z-fs-sm)',
        fontWeight: 700,
        color: 'var(--z-accent)',
        background: 'var(--z-accent-soft)',
        borderRadius: 999,
        padding: '4px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      🪙 {zCoins}
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const zCoins = useZCoinsBalance(Boolean(user));

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (!user) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ZCoinsBadge zCoins={zCoins} />
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
    </div>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
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

        {/* Desktop: full inline nav + name/settings/admin/logout. Hidden on
            mobile — replaced by BottomNav (tabs) + the avatar menu below. */}
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
        <div className="z-navbar-desktop-only" style={{ flexShrink: 0 }}>
          {user ? (
            <div className="z-navbar-user" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ZCoinsBadge zCoins={zCoins} />
              <Link
                href={`/u/${user.id}`}
                style={{
                  fontSize: 'var(--z-fs-sm)',
                  maxWidth: 96,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <PremiumName name={user.displayName} premium={user} />
              </Link>
              <Link href="/settings" className="z-btn-ghost z-pop-on-active" title="Настройки профиля" aria-label="Настройки профиля" style={{ padding: '6px 10px' }}>
                ⚙️
              </Link>
              {user.role === 'OWNER' && (
                <Link href="/admin" style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-accent)' }}>
                  Admin
                </Link>
              )}
              <button onClick={logout} className="z-btn-ghost">
                Выйти
              </button>
            </div>
          ) : (
            <Link href="/login" className="z-btn-accent">
              Войти
            </Link>
          )}
        </div>

        {/* Mobile: just the avatar → dropdown menu (or a login button). */}
        <div className="z-navbar-mobile-only" style={{ flexShrink: 0 }}>
          {user ? <UserMenu /> : (
            <Link href="/login" className="z-btn-accent">
              Войти
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
