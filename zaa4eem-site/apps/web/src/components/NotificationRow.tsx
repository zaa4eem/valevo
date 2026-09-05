'use client';

import type { Notification, NotificationType } from '@zaa4eem/shared';
import { Avatar } from './Avatar';

/** One glyph per event kind, so the list is scannable without reading every line. */
const ICONS: Record<NotificationType, string> = {
  POST_LIKED: '❤️',
  POST_COMMENTED: '💬',
  NEW_FOLLOWER: '👤',
  IDEA_STATUS_CHANGED: '💡',
  IDEA_VOTED: '🔺',
  RECORD_BEATEN: '⚔️',
  PREMIUM_GRANTED: '⭐',
  SYSTEM: '📣',
};

/** "5 минут назад" reads better than a timestamp for anything from today; older entries get a real date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSeconds = Math.round((Date.now() - then) / 1000);

  if (diffSeconds < 60) return 'только что';
  if (diffSeconds < 3600) {
    const minutes = Math.floor(diffSeconds / 60);
    return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;
  }
  if (diffSeconds < 86_400) {
    const hours = Math.floor(diffSeconds / 3600);
    return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  }
  if (diffSeconds < 7 * 86_400) {
    const days = Math.floor(diffSeconds / 86_400);
    return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  }
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Russian needs three forms; the last-two-digits exceptions (11-14) are what a naive `n % 10` gets wrong. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function NotificationRow({
  notification,
  onClick,
}: {
  notification: Notification;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`z-notif-row${notification.read ? '' : ' z-notif-row-unread'}`}
    >
      <span className="z-notif-icon" aria-hidden>
        {notification.actor ? (
          <Avatar name={notification.actor.displayName} avatarUrl={notification.actor.avatarUrl} size={34} />
        ) : (
          <span className="z-notif-icon-system">{ICONS[notification.type]}</span>
        )}
        <span className="z-notif-icon-kind" aria-hidden>
          {ICONS[notification.type]}
        </span>
      </span>
      <span className="z-notif-text">
        <span className="z-notif-body">{notification.body}</span>
        <span className="z-notif-time">{relativeTime(notification.createdAt)}</span>
      </span>
      {!notification.read && <span className="z-notif-dot" aria-label="Новое" />}
    </button>
  );
}
