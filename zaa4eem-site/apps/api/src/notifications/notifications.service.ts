import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import type { NotificationsQuery, UpdateNotificationPrefsInput } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from '../common/telegram-notify.service';
import { NotificationEventsService } from './notification-events.service';
import { PushService } from './push.service';

/**
 * Which per-user switch governs each event type. The in-app bell entry is
 * always written regardless — a list you chose to open can't interrupt you,
 * and having the history is the whole point. These switches only gate the
 * channels that reach out: push and Telegram.
 */
const PREF_BY_TYPE: Record<NotificationType, keyof typeof PREF_COLUMNS | null> = {
  POST_LIKED: 'likes',
  POST_COMMENTED: 'comments',
  NEW_FOLLOWER: 'follows',
  IDEA_STATUS_CHANGED: 'ideas',
  IDEA_VOTED: 'ideas',
  RECORD_BEATEN: 'records',
  PREMIUM_GRANTED: null,
  SYSTEM: null,
};

const PREF_COLUMNS = {
  likes: 'notifyLikes',
  comments: 'notifyComments',
  follows: 'notifyFollows',
  ideas: 'notifyIdeas',
  records: 'notifyRecords',
} as const;

/** Coarse grouping behind the filter chips on the notifications screen. */
const TYPES_BY_FILTER: Record<Exclude<NotificationsQuery['filter'], 'all'>, NotificationType[]> = {
  games: ['RECORD_BEATEN'],
  ideas: ['IDEA_STATUS_CHANGED', 'IDEA_VOTED'],
  social: ['POST_LIKED', 'POST_COMMENTED', 'NEW_FOLLOWER'],
};

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  body: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Optional override; otherwise derived from targetType/targetId. */
  href?: string | null;
  /** Extra line for the Telegram DM, which has no UI to tap through to. */
  telegramText?: string;
}

function hrefFor(targetType: string | null, targetId: string | null): string | null {
  if (!targetType || !targetId) return null;
  switch (targetType) {
    case 'POST':
      return '/';
    case 'IDEA':
      return `/ideas/${targetId}`;
    case 'USER':
      return `/u/${targetId}`;
    case 'GAME':
      return `/games/${targetId}`;
    // A win-back nudge has nothing specific to point at — the feed is what
    // it is inviting the person back to.
    case 'WINBACK':
      return '/';
    default:
      return null;
  }
}

function serialize(notification: {
  id: string;
  type: NotificationType;
  body: string;
  targetType: string | null;
  targetId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
}) {
  return {
    id: notification.id,
    type: notification.type,
    body: notification.body,
    actor: notification.actor
      ? {
          id: notification.actor.id,
          displayName: notification.actor.displayName,
          avatarUrl: notification.actor.avatarUrl,
        }
      : null,
    href: hrefFor(notification.targetType, notification.targetId),
    read: notification.readAt !== null,
    createdAt: notification.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: NotificationEventsService,
    private readonly push: PushService,
    private readonly telegram: TelegramNotifyService,
  ) {}

  /**
   * The single entry point every feature uses to tell someone something
   * happened. Writes the bell entry, then fans out to whichever reach-out
   * channels that user still has switched on.
   *
   * Never throws: this is always called alongside a real action (a like, a
   * comment, a score), and failing to notify must not fail the action.
   */
  async create(input: CreateNotificationInput): Promise<void> {
    try {
      // Nobody needs telling about something they did to themselves.
      if (input.actorId && input.actorId === input.userId) return;

      const recipient = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          telegramId: true,
          notifyLikes: true,
          notifyComments: true,
          notifyFollows: true,
          notifyIdeas: true,
          notifyRecords: true,
          notifyPush: true,
          notifyTelegram: true,
        },
      });
      if (!recipient) return;

      const prefKey = PREF_BY_TYPE[input.type];
      const typeAllowed = prefKey === null ? true : recipient[PREF_COLUMNS[prefKey]];

      const notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          body: input.body,
          actorId: input.actorId ?? null,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
        },
      });

      const unreadCount = await this.unreadCount(input.userId);
      this.events.publish({ userId: input.userId, unreadCount });

      if (!typeAllowed) return;

      if (recipient.notifyPush) {
        await this.push.sendToUser(input.userId, {
          title: 'ZAA4EEM',
          body: input.body,
          url: input.href ?? hrefFor(input.targetType ?? null, input.targetId ?? null) ?? '/notifications',
          tag: notification.id,
        });
      }

      if (recipient.notifyTelegram && recipient.telegramId) {
        await this.telegram.notify(recipient.telegramId, input.telegramText ?? input.body);
      }
    } catch {
      // Swallowed on purpose — see the doc comment above.
    }
  }

  async list(userId: string, query: NotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.filter === 'all' ? {} : { type: { in: TYPES_BY_FILTER[query.filter] } }),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      include: { actor: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map(serialize),
      nextCursor: hasMore ? items[items.length - 1].id : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markAllRead(userId: string): Promise<number> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    this.events.publish({ userId, unreadCount: 0 });
    return 0;
  }

  async markRead(userId: string, notificationId: string): Promise<number> {
    // Scoped by userId as well as id so one person can't mark someone
    // else's notification read by guessing an id.
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const unreadCount = await this.unreadCount(userId);
    this.events.publish({ userId, unreadCount });
    return unreadCount;
  }

  async getPrefs(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        notifyLikes: true,
        notifyComments: true,
        notifyFollows: true,
        notifyIdeas: true,
        notifyRecords: true,
        notifyPush: true,
        notifyTelegram: true,
      },
    });
    return user;
  }

  async updatePrefs(userId: string, input: UpdateNotificationPrefsInput) {
    await this.prisma.user.update({ where: { id: userId }, data: input });
    return this.getPrefs(userId);
  }
}
