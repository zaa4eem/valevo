import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACHIEVEMENTS,
  ONBOARDING_PREMIUM_HOURS,
  ONBOARDING_STEPS,
  REFERRAL_GOALS,
  levelProgress,
  nextStreakMilestone,
  questsForDay,
  referralGoalByCode,
  seasonAt,
  streakMultiplier,
  type AchievementState,
  type ClaimReward,
  type ProgressState,
  type QuestState,
  type SeasonLeaderboardEntry,
} from '@zaa4eem/shared';
import type { UserProgress } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService, utcDay } from './progress.service';
import { ensurePremiumFresh } from '../common/premium.util';
import { NotificationsService } from '../notifications/notifications.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Everything the progress screen reads, and the three things it can claim. */
@Injectable()
export class ProgressViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
  ) {}

  async getState(userId: string): Promise<ProgressState> {
    const row = await this.progress.ensureRow(userId);
    const [quests, season, referralGoals, unlockedCount, onboarding] = await Promise.all([
      this.getQuests(userId, row),
      this.getSeason(userId),
      this.getReferralGoals(userId, row),
      this.prisma.achievementUnlock.count({ where: { userId } }),
      this.getOnboarding(userId, row),
    ]);

    return {
      level: levelProgress(row.xp),
      streak: await this.getStreak(userId, row),
      quests,
      season,
      onboarding,
      referralGoals,
      achievementsUnlocked: unlockedCount,
      achievementsTotal: ACHIEVEMENTS.length,
    };
  }

  private async getStreak(userId: string, row: UserProgress) {
    const today = utcDay();
    const countedToday = row.lastStreakDay?.getTime() === today.getTime();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true },
    });
    const freezeAvailable =
      Boolean(user?.isPremium) &&
      (!row.freezeUsedAt || Date.now() - row.freezeUsedAt.getTime() >= 7 * DAY_MS);

    return {
      days: row.streakDays,
      best: row.streakBest,
      multiplier: streakMultiplier(row.streakDays),
      countedToday,
      freezeAvailable,
      nextMilestone: nextStreakMilestone(row.streakDays),
    };
  }

  private async getQuests(userId: string, row: UserProgress): Promise<QuestState[]> {
    const day = utcDay();
    const definitions = questsForDay(userId, day.toISOString().slice(0, 10));
    const rows = await this.prisma.dailyQuestProgress.findMany({ where: { userId, day } });
    const byCode = new Map(rows.map((r) => [r.code, r]));

    return definitions.map((quest) => {
      const stored = byCode.get(quest.code);
      const progress = Math.min(stored?.progress ?? 0, quest.target);
      return {
        code: quest.code,
        title: quest.title,
        icon: quest.icon,
        href: quest.href,
        progress,
        target: quest.target,
        coins: quest.coins,
        xp: quest.xp,
        done: progress >= quest.target,
        claimed: Boolean(stored?.claimedAt),
      };
    });
  }

  private async getSeason(userId: string) {
    const info = seasonAt();
    const score = await this.prisma.seasonScore.findUnique({
      where: { userId_season: { userId, season: info.index } },
    });
    const xp = score?.xp ?? 0;
    // Rank = how many people are strictly ahead, plus one. Cheaper than
    // ordering the whole season just to find one row.
    const ahead = xp > 0 ? await this.prisma.seasonScore.count({
      where: { season: info.index, xp: { gt: xp } },
    }) : null;

    return { ...info, xp, rank: ahead === null ? null : ahead + 1 };
  }

  private async getOnboarding(userId: string, row: UserProgress) {
    const steps = ONBOARDING_STEPS.map((step) => {
      const counter = step.event === 'IDEA_VOTED' ? 'ideaVotesCast'
        : step.event === 'GAME_PLAYED' ? 'gamesPlayed'
        : step.event === 'FOLLOW_MADE' ? 'followsMade'
        : step.event === 'COMMENT_WRITTEN' ? 'commentsWritten'
        : 'postsPublished';
      return {
        code: step.code,
        title: step.title,
        hint: step.hint,
        icon: step.icon,
        href: step.href,
        done: (row[counter as keyof UserProgress] as number) >= step.target,
      };
    });

    return {
      // Disappears for good once the reward is taken — a finished checklist
      // sitting at the top of the feed forever is just clutter.
      active: !row.onboardingClaimed,
      completed: row.onboardingDone,
      rewardClaimed: row.onboardingClaimed,
      steps,
    };
  }

  private async getReferralGoals(userId: string, row: UserProgress) {
    const claims = await this.prisma.rewardClaim.findMany({
      where: { userId, code: { in: REFERRAL_GOALS.map((g) => g.code) } },
      select: { code: true },
    });
    const claimed = new Set(claims.map((c) => c.code));
    // Counted from the actual referral rows rather than the counter, so a
    // goal is never blocked by a missed increment.
    const invites = await this.prisma.user.count({ where: { invitedById: userId } });
    void row;

    return REFERRAL_GOALS.map((goal) => ({
      code: goal.code,
      title: goal.title,
      description: goal.description,
      icon: goal.icon,
      invites: goal.invites,
      progress: Math.min(invites, goal.invites),
      coins: goal.coins,
      premiumDays: goal.premiumDays,
      reached: invites >= goal.invites,
      claimed: claimed.has(goal.code),
    }));
  }

  async getAchievements(userId: string): Promise<AchievementState[]> {
    const row = await this.progress.ensureRow(userId);
    const unlocks = await this.prisma.achievementUnlock.findMany({ where: { userId } });
    const byCode = new Map(unlocks.map((u) => [u.code, u]));

    return ACHIEVEMENTS.map((a) => {
      const unlock = byCode.get(a.code);
      const raw = row[a.counter as keyof UserProgress] as number;
      return {
        code: a.code,
        title: a.title,
        description: a.description,
        icon: a.icon,
        tier: a.tier,
        group: a.group,
        threshold: a.threshold,
        progress: Math.min(raw ?? 0, a.threshold),
        unlocked: Boolean(unlock),
        unlockedAt: unlock?.unlockedAt.toISOString() ?? null,
        xp: a.xp,
      };
    });
  }

  /** Public: the collection shown on someone else's profile is unlocks only. */
  async getUnlockedAchievements(userId: string) {
    const unlocks = await this.prisma.achievementUnlock.findMany({
      where: { userId },
      orderBy: { unlockedAt: 'desc' },
    });
    return unlocks
      .map((u) => {
        const definition = ACHIEVEMENTS.find((a) => a.code === u.code);
        return definition
          ? {
              code: definition.code,
              title: definition.title,
              description: definition.description,
              icon: definition.icon,
              tier: definition.tier,
              group: definition.group,
              unlockedAt: u.unlockedAt.toISOString(),
            }
          : null;
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }

  async claimQuest(userId: string, code: string): Promise<ClaimReward> {
    const quest = this.progress.questFor(code);
    if (!quest) throw new NotFoundException('Задание не найдено');

    const day = utcDay();
    // The claim is the WHERE, not a read-then-write: two taps on the button
    // can't both pay out, because only one update matches claimedAt = null.
    const result = await this.prisma.dailyQuestProgress.updateMany({
      where: { userId, day, code, claimedAt: null, progress: { gte: quest.target } },
      data: { claimedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('Задание ещё не выполнено или награда уже получена');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { zCoins: { increment: quest.coins } },
    });
    const updated = await this.prisma.userProgress.update({
      where: { userId },
      data: { xp: { increment: quest.xp } },
    });
    await this.applyXpSideEffects(userId, updated.xp, quest.xp);

    return { coins: quest.coins, xp: quest.xp, premiumDays: 0 };
  }

  /** The newcomer checklist's payout: 24 hours of Premium, once ever. */
  async claimOnboarding(userId: string): Promise<ClaimReward> {
    const row = await this.progress.ensureRow(userId);
    if (!row.onboardingDone) throw new BadRequestException('Пройдены не все шаги');

    const result = await this.prisma.userProgress.updateMany({
      where: { userId, onboardingDone: true, onboardingClaimed: false },
      data: { onboardingClaimed: true },
    });
    if (result.count === 0) throw new BadRequestException('Награда уже получена');

    await this.grantPremiumHours(userId, ONBOARDING_PREMIUM_HOURS);
    await this.notifications.create({
      userId,
      type: 'PREMIUM_GRANTED',
      body: `👑 Premium на ${ONBOARDING_PREMIUM_HOURS} часа — за первые пять шагов`,
      targetType: 'PROGRESS',
      targetId: userId,
    });
    return { coins: 0, xp: 0, premiumDays: 1 };
  }

  async claimReferralGoal(userId: string, code: string): Promise<ClaimReward> {
    const goal = referralGoalByCode(code);
    if (!goal) throw new NotFoundException('Цель не найдена');

    const invites = await this.prisma.user.count({ where: { invitedById: userId } });
    if (invites < goal.invites) throw new BadRequestException('Цель ещё не достигнута');

    const claimed = await this.progress.claimReward(userId, goal.code);
    if (!claimed) throw new BadRequestException('Награда уже получена');

    await this.prisma.user.update({
      where: { id: userId },
      data: { zCoins: { increment: goal.coins } },
    });
    if (goal.premiumDays > 0) await this.grantPremiumHours(userId, goal.premiumDays * 24);

    await this.notifications.create({
      userId,
      type: 'PREMIUM_GRANTED',
      body: `${goal.icon} ${goal.title} — ${goal.coins} Z-коинов${goal.premiumDays > 0 ? ` и Premium на ${goal.premiumDays} дн.` : ''}`,
      targetType: 'PROGRESS',
      targetId: userId,
    });

    return { coins: goal.coins, xp: 0, premiumDays: goal.premiumDays };
  }

  /**
   * Extends Premium rather than overwriting it — someone who buys a month
   * and then finishes the newcomer quest should get a month and a day, not
   * lose 29 days. A "forever" grant (isPremium with no premiumUntil) is
   * left completely alone.
   */
  private async grantPremiumHours(userId: string, hours: number): Promise<void> {
    const raw = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await ensurePremiumFresh(this.prisma, raw);
    if (user.isPremium && user.premiumUntil === null) return;

    const from = user.premiumUntil && user.premiumUntil > new Date() ? user.premiumUntil : new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: true,
        premiumUntil: new Date(from.getTime() + hours * HOUR_MS),
        // Give a first-time recipient something visible; leave an existing
        // Premium user's own choices alone.
        ...(user.isPremium ? {} : { nameStyle: 'GLOW', nameColor: '#facc15', ringStyle: 'PULSE' }),
      },
    });
  }

  /** Level-up notification + season score, shared by every path that hands out XP outside record(). */
  private async applyXpSideEffects(userId: string, totalXp: number, gained: number): Promise<void> {
    const season = seasonAt().index;
    await this.prisma.seasonScore.upsert({
      where: { userId_season: { userId, season } },
      update: { xp: { increment: gained } },
      create: { userId, season, xp: gained },
    });

    const { level } = levelProgress(totalXp);
    const row = await this.prisma.userProgress.findUnique({
      where: { userId },
      select: { level: true },
    });
    if (row && row.level !== level) {
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
  }

  async seasonLeaderboard(limit = 20): Promise<SeasonLeaderboardEntry[]> {
    const season = seasonAt().index;
    const rows = await this.prisma.seasonScore.findMany({
      where: { season, xp: { gt: 0 } },
      orderBy: [{ xp: 'desc' }, { userId: 'asc' }],
      take: limit,
      include: {
        user: {
          select: { id: true, displayName: true, avatarUrl: true, progress: { select: { level: true } } },
        },
      },
    });

    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user.id,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
      xp: row.xp,
      level: row.user.progress?.level ?? 1,
    }));
  }
}
