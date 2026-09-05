import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, UserProgress } from '@prisma/client';
import {
  ACHIEVEMENTS,
  FREEZE_COOLDOWN_DAYS,
  ONBOARDING_STEPS,
  STREAK_MILESTONES,
  XP_BY_EVENT,
  achievementByCode,
  levelFromXp,
  questByCode,
  questsForDay,
  seasonAt,
  type AchievementCounter,
  type ProgressEvent,
} from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Which lifetime counter each event advances. */
const COUNTER_BY_EVENT: Record<ProgressEvent, keyof UserProgress | null> = {
  POST_PUBLISHED: 'postsPublished',
  COMMENT_WRITTEN: 'commentsWritten',
  LIKE_RECEIVED: 'likesReceived',
  LIKE_GIVEN: 'likesGiven',
  IDEA_SUBMITTED: 'ideasSubmitted',
  IDEA_ACCEPTED: 'ideasAccepted',
  IDEA_VOTED: 'ideaVotesCast',
  GAME_PLAYED: 'gamesPlayed',
  FOLLOWER_GAINED: 'followersGained',
  FOLLOW_MADE: 'followsMade',
  REFERRAL_JOINED: 'referralsJoined',
  COINS_EARNED: 'coinsEarnedTotal',
  DAILY_CHECKIN: 'daysActive',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of the given moment — the boundary every daily thing here resets on. */
export function utcDay(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * The one entry point every feature calls to say "this person just did
 * something". It fans that single fact out to everything that cares:
 * the streak, XP and level, today's quests, the newcomer checklist, the
 * season score and the achievement collection.
 *
 * Features stay ignorant of all of it — posts.service knows it published a
 * post, not that a post is worth 25 XP and might complete a quest.
 *
 * Never throws, for the same reason NotificationsService.create doesn't:
 * it runs alongside a real action, and failing to award XP must not fail
 * the post.
 */
@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Creates the row on first use, so accounts predating this feature need no backfill. */
  async ensureRow(userId: string): Promise<UserProgress> {
    return this.prisma.userProgress.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async record(userId: string, event: ProgressEvent, amount = 1): Promise<void> {
    if (amount <= 0) return;
    try {
      // Also creates the row on first use, so there is no separate upsert here.
      await this.touchStreak(userId);

      const counter = COUNTER_BY_EVENT[event];
      const xp = XP_BY_EVENT[event] * amount;

      const data: Prisma.UserProgressUpdateInput = {};
      if (counter && counter !== 'daysActive') {
        (data as Record<string, unknown>)[counter] = { increment: amount };
      }
      if (xp > 0) data.xp = { increment: xp };

      if (Object.keys(data).length > 0) {
        const updated = await this.prisma.userProgress.update({ where: { userId }, data });
        await this.syncLevel(userId, updated.xp);
      }
      if (xp > 0) await this.addSeasonXp(userId, xp);

      await this.advanceQuests(userId, event, amount);
      await this.advanceOnboarding(userId);
      // Only the counters this event could have moved — plus level, which any
      // XP award can change. Checking all 38 achievements on every click batch
      // would turn the clicker into the busiest query on the box.
      await this.checkAchievements(
        userId,
        counter ? [counter as AchievementCounter, 'level'] : ['level'],
      );
    } catch (err) {
      this.logger.warn(`Progress for ${event} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Counts today's visit, at most once a day. Returns the row as it now
   * stands, so callers that need the streak (the clicker's multiplier)
   * don't have to re-read it.
   *
   * Premium's "заморозка" forgives exactly one missed day, no more often
   * than once a week — enough that one busy day doesn't erase a month, not
   * enough to keep a streak alive without showing up.
   */
  async touchStreak(userId: string, now = new Date()): Promise<UserProgress> {
    const today = utcDay(now);

    // Cheap path first: the clicker calls this on every batch of taps, and on
    // all but the first of the day the answer is "already counted" — that has
    // to be one indexed read, not a read plus an upsert.
    const existing = await this.prisma.userProgress.findUnique({ where: { userId } });
    if (existing?.lastStreakDay?.getTime() === today.getTime()) return existing;

    const row = existing ?? (await this.ensureRow(userId));

    const gapDays = row.lastStreakDay
      ? Math.round((today.getTime() - row.lastStreakDay.getTime()) / DAY_MS)
      : null;

    let days: number;
    let freezeUsedAt = row.freezeUsedAt;

    if (gapDays === 1 || gapDays === null) {
      days = row.streakDays + 1;
    } else if (gapDays === 2 && (await this.freezeAvailable(userId, row, now))) {
      // Exactly one day missed, and Premium's freeze is off cooldown.
      days = row.streakDays + 1;
      freezeUsedAt = now;
    } else {
      days = 1;
    }

    const updated = await this.prisma.userProgress.update({
      where: { userId },
      data: {
        streakDays: days,
        streakBest: Math.max(days, row.streakBest),
        lastStreakDay: today,
        freezeUsedAt,
        daysActive: { increment: 1 },
        xp: { increment: XP_BY_EVENT.DAILY_CHECKIN },
      },
    });

    await this.syncLevel(userId, updated.xp);
    await this.addSeasonXp(userId, XP_BY_EVENT.DAILY_CHECKIN);
    await this.payStreakMilestone(userId, days);
    // A longer streak is the one thing only this method can unlock.
    await this.checkAchievements(userId, ['streakBest', 'level']);
    return updated;
  }

  private async freezeAvailable(userId: string, row: UserProgress, now: Date): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true },
    });
    if (!user?.isPremium) return false;
    if (!row.freezeUsedAt) return true;
    return now.getTime() - row.freezeUsedAt.getTime() >= FREEZE_COOLDOWN_DAYS * DAY_MS;
  }

  /** One-off coin bonus at 3/7/14/30/100 days. RewardClaim keeps it to once per milestone, ever. */
  private async payStreakMilestone(userId: string, days: number): Promise<void> {
    const milestone = STREAK_MILESTONES.find((m) => m.day === days);
    if (!milestone) return;
    const code = `streak_${milestone.day}`;
    const claimed = await this.claimOnce(userId, code);
    if (!claimed) return;

    await this.prisma.user.update({
      where: { id: userId },
      data: { zCoins: { increment: milestone.coins } },
    });
    await this.notifications.create({
      userId,
      type: 'SYSTEM',
      body: `🔥 ${milestone.label} — награда ${milestone.coins} Z-коинов`,
      targetType: 'PROGRESS',
      targetId: userId,
    });
  }

  /**
   * Inserts a RewardClaim, returning false if one already existed. The
   * unique index does the work, so two concurrent requests can't both pay
   * the same reward.
   */
  private async claimOnce(userId: string, code: string): Promise<boolean> {
    const result = await this.prisma.rewardClaim.createMany({
      data: [{ userId, code }],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  private async syncLevel(userId: string, xp: number): Promise<void> {
    const level = levelFromXp(xp);
    const row = await this.prisma.userProgress.findUnique({
      where: { userId },
      select: { level: true },
    });
    if (!row || row.level === level) return;
    await this.prisma.userProgress.update({ where: { userId }, data: { level } });
    if (level > row.level) {
      await this.notifications.create({
        userId,
        type: 'SYSTEM',
        body: `⭐ Новый уровень: ${level}`,
        targetType: 'PROGRESS',
        targetId: userId,
      });
    }
  }

  private async addSeasonXp(userId: string, xp: number): Promise<void> {
    if (xp <= 0) return;
    const season = seasonAt().index;
    await this.prisma.seasonScore.upsert({
      where: { userId_season: { userId, season } },
      update: { xp: { increment: xp } },
      create: { userId, season, xp },
    });
  }

  private async advanceQuests(userId: string, event: ProgressEvent, amount: number): Promise<void> {
    const day = utcDay();
    const todays = questsForDay(userId, day.toISOString().slice(0, 10)).filter((q) => q.event === event);
    for (const quest of todays) {
      await this.prisma.dailyQuestProgress.upsert({
        where: { userId_day_code: { userId, day, code: quest.code } },
        update: { progress: { increment: amount } },
        create: { userId, day, code: quest.code, progress: amount },
      });
    }
  }

  /**
   * The newcomer checklist is measured against the same lifetime counters
   * as everything else, so it can't be gamed by doing a step before the
   * account existed — and re-checking it is a single read.
   */
  private async advanceOnboarding(userId: string): Promise<void> {
    const row = await this.prisma.userProgress.findUnique({ where: { userId } });
    if (!row || row.onboardingDone) return;
    const done = ONBOARDING_STEPS.every((step) => {
      const counter = COUNTER_BY_EVENT[step.event];
      return counter ? (row[counter] as number) >= step.target : false;
    });
    if (!done) return;

    await this.prisma.userProgress.update({ where: { userId }, data: { onboardingDone: true } });
    await this.notifications.create({
      userId,
      type: 'SYSTEM',
      body: '🎁 Все пять шагов пройдены — заберите 24 часа Premium',
      targetType: 'PROGRESS',
      targetId: userId,
    });
  }

  /**
   * Unlocks whatever the current counters now qualify for. Loops because an
   * achievement's own XP can raise the level past a level achievement —
   * bounded so a mis-specified catalogue can't spin forever.
   */
  private async checkAchievements(userId: string, counters?: AchievementCounter[]): Promise<void> {
    const watched = counters
      ? ACHIEVEMENTS.filter((a) => counters.includes(a.counter))
      : ACHIEVEMENTS;
    if (watched.length === 0) return;

    for (let pass = 0; pass < 3; pass += 1) {
      const row = await this.prisma.userProgress.findUnique({ where: { userId } });
      if (!row) return;

      const earned = watched
        .filter((a) => (row[a.counter as keyof UserProgress] as number) >= a.threshold)
        .map((a) => a.code);
      if (earned.length === 0) return;

      const already = await this.prisma.achievementUnlock.findMany({
        where: { userId, code: { in: earned } },
        select: { code: true },
      });
      const have = new Set(already.map((a) => a.code));
      const fresh = earned.filter((code) => !have.has(code));
      if (fresh.length === 0) return;

      await this.prisma.achievementUnlock.createMany({
        data: fresh.map((code) => ({ userId, code })),
        skipDuplicates: true,
      });

      let bonus = 0;
      for (const code of fresh) {
        const definition = achievementByCode(code);
        if (!definition) continue;
        bonus += definition.xp;
        await this.notifications.create({
          userId,
          type: 'SYSTEM',
          body: `${definition.icon} Достижение получено: «${definition.title}»`,
          targetType: 'PROGRESS',
          targetId: userId,
        });
      }

      if (bonus > 0) {
        const updated = await this.prisma.userProgress.update({
          where: { userId },
          data: { xp: { increment: bonus } },
        });
        await this.syncLevel(userId, updated.xp);
        await this.addSeasonXp(userId, bonus);
      }
    }
  }

  /** Exposed for the quest-claim endpoint, which needs the same once-only guarantee. */
  claimReward(userId: string, code: string): Promise<boolean> {
    return this.claimOnce(userId, code);
  }

  /** Used by the clicker to look up the streak multiplier without a second round trip. */
  getRow(userId: string): Promise<UserProgress | null> {
    return this.prisma.userProgress.findUnique({ where: { userId } });
  }

  /** Quest definitions are code, not data — re-exported so the controller doesn't import from two places. */
  questFor(code: string) {
    return questByCode(code);
  }
}
