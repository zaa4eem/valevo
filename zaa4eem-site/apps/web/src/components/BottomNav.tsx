'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/', label: 'Лента', icon: '🟢' },
  { href: '/ideas', label: 'Идеи', icon: '💡' },
  { href: '/search', label: 'Поиск', icon: '🔍' },
  { href: '/games', label: 'Игры', icon: '🎮' },
  { href: '/leaderboard', label: 'Лидеры', icon: '🏆' },
];

/** Mobile-only (see .z-bottom-nav's media query) — replaces the crowded
 * single-row top nav on narrow screens with a native-app-style tab bar. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="z-bottom-nav">
      {tabs.map((tab) => {
        const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="z-bottom-nav-item z-pop-on-active"
            style={{ color: active ? 'var(--z-accent)' : 'var(--z-text-muted)' }}
          >
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span style={{ fontSize: 'var(--z-fs-xs)', fontWeight: active ? 700 : 500 }}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
