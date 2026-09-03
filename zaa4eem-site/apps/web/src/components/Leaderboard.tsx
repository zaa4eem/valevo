import type { LeaderboardEntry } from '@zaa4eem/shared';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';

// Rank 1-3 get a medal + a color-mix ramp off the site's own accent, the
// same technique the admin dashboard's charts use for a sequential scale —
// no new hardcoded colors, just accent blended toward the surface tone.
const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const RANK_TINTS: Record<number, string> = {
  1: 'color-mix(in oklab, var(--z-accent) 32%, var(--z-surface))',
  2: 'color-mix(in oklab, var(--z-accent) 20%, var(--z-surface))',
  3: 'color-mix(in oklab, var(--z-accent) 12%, var(--z-surface))',
};
const RANK_BORDERS: Record<number, string> = {
  1: 'color-mix(in oklab, var(--z-accent) 70%, transparent)',
  2: 'color-mix(in oklab, var(--z-accent) 45%, transparent)',
  3: 'color-mix(in oklab, var(--z-accent) 28%, transparent)',
};

export function Leaderboard({ title, entries }: { title: string; entries: LeaderboardEntry[] }) {
  return (
    <Card hover>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        🏆 {title}
      </h3>
      {entries.length === 0 ? (
        <EmptyState icon="🏆" description="Пока никто не играл — будь первым." />
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((entry, i) => {
            const medal = RANK_MEDALS[entry.rank];
            return (
              <li
                key={entry.userId}
                className="z-animate-in"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 'var(--z-radius-md)',
                  background: RANK_TINTS[entry.rank] ?? 'transparent',
                  border: `1px solid ${RANK_BORDERS[entry.rank] ?? 'transparent'}`,
                  animationDelay: `${Math.min(i, 8) * 40}ms`,
                }}
              >
                <span
                  style={{
                    width: 28,
                    textAlign: 'center',
                    fontWeight: 800,
                    fontSize: medal ? 'var(--z-fs-lg)' : 'var(--z-fs-base)',
                    color: entry.rank <= 3 ? 'var(--z-accent)' : 'var(--z-text-muted)',
                    flexShrink: 0,
                  }}
                >
                  {medal ?? entry.rank}
                </span>
                <Avatar name={entry.displayName} avatarUrl={entry.avatarUrl} size={34} />
                <span style={{ flex: 1, fontWeight: entry.rank <= 3 ? 700 : 500, minWidth: 0 }}>
                  {entry.displayName}
                </span>
                <span style={{ fontWeight: 800, color: entry.rank <= 3 ? 'var(--z-accent)' : 'var(--z-text)' }}>
                  {entry.value}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
