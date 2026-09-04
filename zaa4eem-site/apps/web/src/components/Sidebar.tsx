'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/admin', label: 'Обзор' },
  { href: '/admin/users', label: 'Пользователи' },
  { href: '/admin/ideas', label: 'Идеи' },
  { href: '/admin/moderation', label: 'Модерация' },
  { href: '/admin/posts', label: 'Лента' },
  { href: '/admin/idea-credits', label: 'Авторы идей' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--z-border)',
        padding: '24px 12px',
      }}
    >
      <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', padding: '0 12px 12px' }}>
        ADMIN
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--z-radius-sm)',
                fontSize: 'var(--z-fs-sm)',
                background: active ? 'var(--z-accent-soft)' : 'transparent',
                color: active ? 'var(--z-accent)' : 'var(--z-text-muted)',
                fontWeight: active ? 700 : 500,
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
