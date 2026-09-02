import { Injectable } from '@nestjs/common';
import { IdeaStatus, ModerationState } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async moderationQueue() {
    const [pendingIdeas, heldScores] = await Promise.all([
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

  async stats() {
    const [totalUsers, ideaCounts, ideasPendingModeration, totalGamePlays] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.idea.groupBy({ by: ['status'], _count: true }),
      this.prisma.idea.count({ where: { moderationState: ModerationState.PENDING_REVIEW } }),
      this.prisma.score.count(),
    ]);

    const ideasByStatus: Record<string, number> = {};
    for (const status of Object.values(IdeaStatus)) ideasByStatus[status] = 0;
    for (const row of ideaCounts) ideasByStatus[row.status] = row._count;

    return { totalUsers, ideasByStatus, ideasPendingModeration, totalGamePlays };
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
