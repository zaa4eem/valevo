import type { Presence } from '@zaa4eem/shared';

const LABEL: Record<Presence, string> = {
  ONLINE: 'В сети',
  AWAY: 'Отошёл',
  OFFLINE: 'Не в сети',
};

const MODIFIER: Record<Presence, string> = {
  ONLINE: 'online',
  AWAY: 'away',
  OFFLINE: 'offline',
};

export function PresenceDot({ presence, style }: { presence: Presence; style?: React.CSSProperties }) {
  return (
    <span
      className={`z-presence-dot z-presence-dot--${MODIFIER[presence]}`}
      title={LABEL[presence]}
      style={style}
    />
  );
}
