'use client';

import { usePathname } from 'next/navigation';
import { TransitionLink } from './TransitionLink';

const items = [
  { href: '/admin', label: 'Обзор', icon: '📊' },
  { href: '/admin/users', label: 'Пользователи', icon: '👥' },
  { href: '/admin/ideas', label: 'Идеи', icon: '💡' },
  { href: '/admin/moderation', label: 'Модерация', icon: '🛡️' },
  { href: '/admin/posts', label: 'Лента', icon: '📝' },
  { href: '/admin/idea-credits', label: 'Авторы идей', icon: '🏅' },
];

/**
 * Admin section navigation.
 *
 * The same list renders two ways, chosen entirely in CSS (see .z-admin-nav):
 * a left rail on a wide screen, and a horizontal scrolling strip of chips on
 * a phone. The rail was a fixed 220px, which on a 390px screen left about
 * 150px for the actual content — the section list was bigger than the
 * section. Above the fold and one thumb-swipe wide is the right shape for
 * navigation you use once per visit.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="z-admin-nav" aria-label="Разделы админки">
      <span className="z-admin-nav-title">ADMIN</span>
      <div className="z-admin-nav-items">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <TransitionLink
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`z-admin-nav-item${active ? ' z-admin-nav-item-active' : ''}`}
            >
              <span aria-hidden>{item.icon}</span>
              <span>{item.label}</span>
            </TransitionLink>
          );
        })}
      </div>
    </nav>
  );
}
