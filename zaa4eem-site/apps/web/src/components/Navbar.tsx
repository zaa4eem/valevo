'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Avatar } from './Avatar';

const links = [
  { href: '/', label: 'Лента' },
  { href: '/ideas', label: 'Идеи' },
  { href: '/games', label: 'Игры' },
  { href: '/leaderboard', label: 'Лидеры' },
];

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
        <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size={36} />
      </button>
      {open && (
        <div className="z-navbar-menu z-animate-fade">
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--z-border)', fontWeight: 700 }}>
            {user.displayName}
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
  );
}

export function Navbar() {
  const { user, logout } = useAuth();

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
                {user.displayName}
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
