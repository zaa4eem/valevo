import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--z-surface)',
        border: '1px solid var(--z-border)',
        borderRadius: 'var(--z-radius-lg)',
        boxShadow: 'var(--z-shadow-card)',
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}
