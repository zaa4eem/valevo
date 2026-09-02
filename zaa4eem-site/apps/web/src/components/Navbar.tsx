'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

const links = [
  { href: '/', label: 'Лента' },
  { href: '/ideas', label: 'Идеи' },
  { href: '/games', label: 'Игры' },
  { href: '/leaderboard', label: 'Лидеры' },
];

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header
      style={{
        borderBottom: '1px solid var(--z-border)',
        position: 'sticky',
        top: 0,
        background: 'rgba(11,14,13,0.9)',
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
        <nav className="z-navbar-links" style={{ minWidth: 0 }}>
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
        <div style={{ flexShrink: 0 }}>
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
      </div>
    </header>
  );
}
