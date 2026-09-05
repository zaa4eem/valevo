'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/Sidebar';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user || user.role !== 'OWNER') {
    return (
      <p style={{ color: 'var(--z-text-muted)' }}>
        Раздел доступен только владельцу платформы.
      </p>
    );
  }

  // Direction flips in CSS at the breakpoint: a row with a left rail on a
  // wide screen, a column with the nav strip on top on a phone.
  return (
    <div className="z-admin-layout">
      <Sidebar />
      <div className="z-admin-content">{children}</div>
    </div>
  );
}
