import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/** How long someone has to be gone before it's worth reaching out. */
export const IDLE_BEFORE_WINBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Past this, they've moved on — nagging a long-dead account is how a sender ends up marked as spam. */
export const GIVE_UP_AFTER_MS = 45 * 24 * 60 * 60 * 1000;
/** Never nudge the same person twice inside this window, even if they stay away. */
export const WINBACK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/** How often the sweep runs. */
export const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Cap per sweep, so one run can't blast the whole table at a push service. */
export const MAX_PER_SWEEP = 50;
/** Marks a win-back row so the cooldown check can find it without another column. */
const WINBACK_TARGET = 'WINBACK';

/**
 * The "мы скучали" nudge: one message to people who stopped coming back,
 * built from what actually happened while they were away rather than a
 * generic "we miss you", which is easy to ignore and easy to resent.
 *
 * Three rules keep it from becoming spam: a person must have been gone a
 * week, must not have been gone so long that they've clearly left, and gets
 * at most one nudge a fortnight. It also respects the same per-user switches
 * as everything else — NotificationsService.create() handles that.
 */
@Injectable()
export class ReEngagementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReEngagementService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Tests drive sweep() directly; a live interval would outlive the run.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        this.logger.warn(`Win-back sweep failed: ${err instanceof Error ? err.message : err}`);
      });
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many nudges were sent. Also used by the admin trigger and tests. */
  async sweep(now = new Date()): Promise<number> {
    const idleSince = new Date(now.getTime() - IDLE_BEFORE_WINBACK_MS);
    const giveUpBefore = new Date(now.getTime() - GIVE_UP_AFTER_MS);
    const cooldownSince = new Date(now.getTime() - WINBACK_COOLDOWN_MS);

    const candidates = await this.prisma.user.findMany({
      where: {
        lastActiveAt: { lt: idleSince, gt: giveUpBefore },
        status: { not: 'BANNED' },
        notifications: {
          none: { targetType: WINBACK_TARGET, createdAt: { gte: cooldownSince } },
        },
      },
      select: { id: true, displayName: true, lastActiveAt: true },
      orderBy: { lastActiveAt: 'desc' },
      take: MAX_PER_SWEEP,
    });

    let sent = 0;
    for (const user of candidates) {
      const since = user.lastActiveAt ?? idleSince;
      const summary = await this.buildSummary(user.id, since);
      if (!summary) continue;
      await this.notifications.create({
        userId: user.id,
        type: 'SYSTEM',
        targetType: WINBACK_TARGET,
        targetId: user.id,
        body: summary.short,
        telegramText: `👋 ${user.displayName}, мы скучали!\n\n${summary.long}\n\nЗаглядывайте: ${'https://zaa4eem.ru'}`,
      });
      sent += 1;
    }

    if (sent > 0) this.logger.log(`Win-back nudges sent: ${sent}`);
    return sent;
  }

  /**
   * Nothing happened while they were away → nothing worth sending. Returning
   * null here is what stops the nudge from degrading into "мы скучали" with
   * no reason attached.
   */
  private async buildSummary(
    userId: string,
    since: Date,
  ): Promise<{ short: string; long: string } | null> {
    const [newPosts, newIdeas, newFollowers, missedNotifications] = await Promise.all([
      this.prisma.post.count({
        where: { createdAt: { gte: since }, publishedAt: { not: null }, authorId: { not: userId } },
      }),
      this.prisma.idea.count({ where: { createdAt: { gte: since }, submitterId: { not: userId } } }),
      this.prisma.follow.count({ where: { followingId: userId, createdAt: { gte: since } } }),
      this.prisma.notification.count({
        where: { userId, readAt: null, createdAt: { gte: since }, targetType: { not: WINBACK_TARGET } },
      }),
    ]);

    const parts: string[] = [];
    // Personal first — "трое подписались на вас" pulls harder than any
    // site-wide number.
    if (newFollowers > 0) parts.push(`${newFollowers} ${plural(newFollowers, 'новый подписчик', 'новых подписчика', 'новых подписчиков')}`);
    if (missedNotifications > 0) {
      parts.push(`${missedNotifications} ${plural(missedNotifications, 'непрочитанное уведомление', 'непрочитанных уведомления', 'непрочитанных уведомлений')}`);
    }
    if (newPosts > 0) parts.push(`${newPosts} ${plural(newPosts, 'новый пост', 'новых поста', 'новых постов')}`);
    if (newIdeas > 0) parts.push(`${newIdeas} ${plural(newIdeas, 'новая идея', 'новые идеи', 'новых идей')}`);

    if (parts.length === 0) return null;

    return {
      short: `Пока вас не было: ${parts.join(', ')}`,
      long: parts.map((part) => `• ${part}`).join('\n'),
    };
  }
}

/** Russian's three plural forms; 11-14 are the exceptions a plain `n % 10` gets wrong. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
