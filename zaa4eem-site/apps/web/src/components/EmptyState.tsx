import type { ReactNode } from 'react';
import { Card } from './Card';

/**
 * A muted "nothing here yet" card — generalizes the pattern already used
 * ad hoc for the feed's empty state (icon + message, centered, on a Card).
 */
export function EmptyState({
  icon = '🟢',
  title,
  description,
  action,
}: {
  icon?: string;
  title?: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="z-animate-in" style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>{icon}</div>
      {title && <h3 style={{ margin: '0 0 6px' }}>{title}</h3>}
      <p style={{ color: 'var(--z-text-muted)', margin: 0 }}>{description}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </Card>
  );
}
