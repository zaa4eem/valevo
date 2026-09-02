import type { LeaderboardEntry } from '@zaa4eem/shared';
import { Card } from './Card';

export function Leaderboard({ title, entries }: { title: string; entries: LeaderboardEntry[] }) {
  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {entries.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
          Пока никто не играл — будь первым.
        </p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((entry) => (
            <li
              key={entry.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 10px',
                borderRadius: 'var(--z-radius-sm)',
                background: entry.rank <= 3 ? 'var(--z-accent-soft)' : 'transparent',
              }}
            >
              <span
                style={{
                  width: 24,
                  textAlign: 'center',
                  fontWeight: 800,
                  color: entry.rank <= 3 ? 'var(--z-accent)' : 'var(--z-text-muted)',
                }}
              >
                {entry.rank}
              </span>
              <span style={{ flex: 1 }}>{entry.displayName}</span>
              <span style={{ fontWeight: 700 }}>{entry.value}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
