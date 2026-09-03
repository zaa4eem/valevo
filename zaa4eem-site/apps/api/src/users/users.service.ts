import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  setPassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async updateProfile(
    userId: string,
    data: {
      displayName?: string;
      avatarUrl?: string | null;
      bio?: string | null;
      statusText?: string | null;
    },
  ) {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new ForbiddenException('Нельзя подписаться на самого себя');
    }
    const target = await this.prisma.user.findUnique({ where: { id: followingId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    try {
      await this.prisma.follow.create({ data: { followerId, followingId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Вы уже подписаны на этого пользователя');
      }
      throw err;
    }
  }

  async unfollow(followerId: string, followingId: string) {
    await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
  }

  /** Public profile + derived stats (FR-004). */
  async getPublicProfile(userId: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const [ideasSubmittedCount, ideasAcceptedCount, scores, followerCount, followingCount, viewerFollow] =
      await Promise.all([
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
        this.prisma.follow.count({ where: { followingId: userId } }),
        this.prisma.follow.count({ where: { followerId: userId } }),
        viewerId
          ? this.prisma.follow.findUnique({
              where: { followerId_followingId: { followerId: viewerId, followingId: userId } },
            })
          : null,
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
      memberNumber: user.memberNumber,
      role: user.role,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      statusText: user.statusText,
      createdAt: user.createdAt.toISOString(),
      followerCount,
      followingCount,
      viewerIsFollowing: viewerId ? Boolean(viewerFollow) : undefined,
      stats: {
        ideasSubmittedCount,
        ideasAcceptedCount,
        gamesPlayedCount: scores.length,
        bestScoresByGame: [...bestByGame.values()],
      },
    };
  }
}
