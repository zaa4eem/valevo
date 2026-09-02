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

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
