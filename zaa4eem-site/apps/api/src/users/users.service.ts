import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IdeaStatus } from '@zaa4eem/shared';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByTelegramId(telegramId: bigint) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  createFromTelegram(input: { telegramId: bigint; telegramUsername?: string; displayName: string; avatarUrl?: string }) {
    return this.prisma.user.create({
      data: {
        telegramId: input.telegramId,
        telegramUsername: input.telegramUsername,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
      },
    });
  }

  createWithPassword(input: { email: string; passwordHash: string; displayName: string }) {
    return this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
      },
    });
  }

  linkTelegram(userId: string, telegramId: bigint, telegramUsername?: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { telegramId, telegramUsername },
    });
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; avatarUrl?: string | null; bio?: string | null },
  ) {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  /** Public profile + derived stats (FR-004). */
  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const [ideasSubmittedCount, ideasAcceptedCount, scores] = await Promise.all([
      this.prisma.idea.count({ where: { submitterId: userId } }),
      this.prisma.idea.count({
        where: {
          submitterId: userId,
          status: { in: [IdeaStatus.ACCEPTED, IdeaStatus.IN_PROGRESS, IdeaStatus.SHIPPED] },
        },
      }),
      this.prisma.score.findMany({
        where: { userId, reviewState: 'NORMAL' },
        include: { game: true },
        orderBy: { value: 'desc' },
      }),
    ]);

    const bestByGame = new Map<string, { gameSlug: string; gameTitle: string; value: number }>();
    for (const score of scores) {
      const existing = bestByGame.get(score.gameId);
      if (!existing || score.value > existing.value) {
        bestByGame.set(score.gameId, {
          gameSlug: score.game.slug,
          gameTitle: score.game.title,
          value: score.value,
        });
      }
    }

    return {
      id: user.id,
      role: user.role,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      createdAt: user.createdAt.toISOString(),
      stats: {
        ideasSubmittedCount,
        ideasAcceptedCount,
        gamesPlayedCount: scores.length,
        bestScoresByGame: [...bestByGame.values()],
      },
    };
  }
}
