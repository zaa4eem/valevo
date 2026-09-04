import { Injectable } from '@nestjs/common';
import { IdeaStatus, ModerationState, SetPremiumInput } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { addMonths } from '../common/premium.util';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async moderationQueue() {
    const [pendingIdeas, heldScores, pendingPosts] = await Promise.all([
      this.prisma.idea.findMany({
        where: { moderationState: ModerationState.PENDING_REVIEW },
        include: { submitter: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.score.findMany({
        where: { reviewState: 'HELD_FOR_REVIEW' },
        include: { user: true, game: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.post.findMany({
        where: { moderationState: ModerationState.PENDING_REVIEW },
        include: { author: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      ideas: pendingIdeas.map((idea) => ({
        id: idea.id,
        title: idea.title,
        description: idea.description,
        submitter: { id: idea.submitter.id, displayName: idea.submitter.displayName },
        createdAt: idea.createdAt.toISOString(),
      })),
      scores: heldScores.map((score) => ({
        id: score.id,
        value: score.value,
        game: { slug: score.game.slug, title: score.game.title },
        user: { id: score.user.id, displayName: score.user.displayName },
        createdAt: score.createdAt.toISOString(),
      })),
      posts: pendingPosts.map((post) => ({
        id: post.id,
        body: post.body,
        imageUrl: post.imageUrl,
        author: { id: post.author.id, displayName: post.author.displayName },
        createdAt: post.createdAt.toISOString(),
      })),
    };
  }

  async moderationLog(limit = 50) {
    const entries = await this.prisma.moderationLogEntry.findMany({
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return entries.map((entry) => ({
      id: entry.id,
      actor: { id: entry.actor.id, displayName: entry.actor.displayName },
      targetType: entry.targetType,
      targetId: entry.targetId,
      action: entry.action,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      include: { _count: { select: { followers: true } } },
      orderBy: { memberNumber: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      memberNumber: u.memberNumber,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      role: u.role,
      status: u.status,
      email: u.email,
      telegramUsername: u.telegramUsername,
      followerCount: u._count.followers,
      createdAt: u.createdAt.toISOString(),
      isPremium: u.isPremium,
      nameStyle: u.nameStyle,
      nameColor: u.nameColor,
      ringStyle: u.ringStyle,
      nameFont: u.nameFont,
      badgeEmoji: u.badgeEmoji,
      premiumUntil: u.premiumUntil?.toISOString() ?? null,
    }));
  }

  async stats() {
    const [totalUsers, ideaCounts, ideasPendingModeration, totalGamePlays, dailySeries] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.idea.groupBy({ by: ['status'], _count: true }),
        this.prisma.idea.count({ where: { moderationState: ModerationState.PENDING_REVIEW } }),
        this.prisma.score.count(),
        this.dailySeries(),
      ]);

    const ideasByStatus: Record<string, number> = {};
    for (const status of Object.values(IdeaStatus)) ideasByStatus[status] = 0;
    for (const row of ideaCounts) ideasByStatus[row.status] = row._count;

    const userGrowth = dailySeries.map((row) => ({ date: row.date, count: row.users }));
    const activity = dailySeries.map((row) => ({
      date: row.date,
      posts: row.posts,
      ideas: row.ideas,
      scores: row.scores,
    }));

    return { totalUsers, ideasByStatus, ideasPendingModeration, totalGamePlays, userGrowth, activity };
  }

  /**
   * Daily counts (zero-filled) of new users/posts/ideas/game-scores for the
   * trailing 30 days, oldest day first. One raw query with `generate_series`
   * so days with no rows still appear as zero — this is a young platform
   * (dozens to low hundreds of rows), so a single Postgres pass is plenty;
   * no need for a rollup table or a heavier time-series approach yet.
   */
  private async dailySeries(): Promise<Array<{ date: string; users: number; posts: number; ideas: number; scores: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; users: number; posts: number; ideas: number; scores: number }>>`
      WITH days AS (
        SELECT generate_series(current_date - interval '29 days', current_date, interval '1 day')::date AS day
      ),
      u AS (
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS n
        FROM "User"
        WHERE "createdAt" >= current_date - interval '29 days'
        GROUP BY 1
      ),
      p AS (
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS n
        FROM "Post"
        WHERE "createdAt" >= current_date - interval '29 days'
        GROUP BY 1
      ),
      i AS (
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS n
        FROM "Idea"
        WHERE "createdAt" >= current_date - interval '29 days'
        GROUP BY 1
      ),
      s AS (
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS n
        FROM "Score"
        WHERE "createdAt" >= current_date - interval '29 days'
        GROUP BY 1
      )
      SELECT
        days.day AS day,
        COALESCE(u.n, 0) AS users,
        COALESCE(p.n, 0) AS posts,
        COALESCE(i.n, 0) AS ideas,
        COALESCE(s.n, 0) AS scores
      FROM days
      LEFT JOIN u ON u.day = days.day
      LEFT JOIN p ON p.day = days.day
      LEFT JOIN i ON i.day = days.day
      LEFT JOIN s ON s.day = days.day
      ORDER BY days.day ASC;
    `;

    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      users: Number(row.users),
      posts: Number(row.posts),
      ideas: Number(row.ideas),
      scores: Number(row.scores),
    }));
  }

  async muteUser(userId: string, actorId: string, reason: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'MUTED' } });
    await this.logAction(actorId, 'USER', userId, 'mute', reason);
  }

  async banUser(userId: string, actorId: string, reason: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'BANNED' } });
    await this.tokens.revokeAllForUser(userId);
    await this.logAction(actorId, 'USER', userId, 'ban', reason);
  }

  async activateUser(userId: string, actorId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    await this.logAction(actorId, 'USER', userId, 'activate');
  }

  /** Cosmetic-only, owner-granted — never self-service (no equivalent user-facing endpoint exists). durationMonths null/omitted grants forever ("Навсегда"); a number sets a term the user's Premium lazily expires from (see premium.util.ts). */
  async setPremium(userId: string, actorId: string, input: SetPremiumInput) {
    const data = input.isPremium
      ? {
          isPremium: true,
          nameStyle: input.nameStyle ?? null,
          nameColor: input.nameColor ?? null,
          ringStyle: input.ringStyle ?? null,
          nameFont: input.nameFont ?? null,
          badgeEmoji: input.badgeEmoji ?? null,
          premiumUntil: input.durationMonths ? addMonths(new Date(), input.durationMonths) : null,
        }
      : {
          isPremium: false,
          nameStyle: null,
          nameColor: null,
          ringStyle: null,
          nameFont: null,
          badgeEmoji: null,
          premiumUntil: null,
        };

    await this.prisma.user.update({ where: { id: userId }, data });
    await this.logAction(actorId, 'USER', userId, input.isPremium ? 'premium:granted' : 'premium:revoked');
  }

  private logAction(
    actorId: string,
    targetType: 'IDEA' | 'POST' | 'USER' | 'SCORE',
    targetId: string,
    action: string,
    reason?: string,
  ) {
    return this.prisma.moderationLogEntry.create({
      data: { actorId, targetType, targetId, action, reason },
    });
  }
}
