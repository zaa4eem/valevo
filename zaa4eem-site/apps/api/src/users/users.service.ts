import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdeaStatus } from '@zaa4eem/shared';
import { TelegramNotifyService } from '../common/telegram-notify.service';

function serializeUserSummary(user: any) {
  return {
    id: user.id,
    memberNumber: user.memberNumber,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    isPremium: user.isPremium,
    nameStyle: user.nameStyle,
    nameColor: user.nameColor,
    ringStyle: user.ringStyle,
    badgeEmoji: user.badgeEmoji,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: TelegramNotifyService,
  ) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByTelegramId(telegramId: bigint) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByGoogleId(googleId: string) {
    return this.prisma.user.findUnique({ where: { googleId } });
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

  createFromGoogle(input: { googleId: string; email?: string; displayName: string; avatarUrl?: string }) {
    return this.prisma.user.create({
      data: {
        googleId: input.googleId,
        email: input.email,
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

  linkGoogle(userId: string, googleId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { googleId },
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

  /**
   * Self-service: a user the owner already granted Premium to picks their
   * own look from the same fixed option set the owner uses — grant/revoke
   * of isPremium itself stays owner-only (AdminService.setPremium).
   */
  async updatePremiumStyle(
    userId: string,
    data: {
      nameStyle: 'FLOW' | 'HOLO' | 'GLOW' | null;
      nameColor: string | null;
      ringStyle: 'SPIN' | 'PULSE' | null;
      badgeEmoji: string | null;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } });
    if (!user?.isPremium) {
      throw new ForbiddenException('Эта функция доступна только Premium-пользователям');
    }
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

    if (target.telegramId) {
      const follower = await this.prisma.user.findUnique({
        where: { id: followerId },
        select: { displayName: true },
      });
      if (follower) {
        this.notify
          .notify(target.telegramId, `➕ ${follower.displayName} подписался(лась) на вас`)
          .catch(() => undefined);
      }
    }
  }

  async unfollow(followerId: string, followingId: string) {
    await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
  }

  async getFollowers(userId: string, opts: { cursor?: string; limit?: number }) {
    const limit = opts.limit ?? 20;
    const follows = await this.prisma.follow.findMany({
      where: { followingId: userId },
      include: { follower: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = follows.length > limit;
    const items = hasMore ? follows.slice(0, limit) : follows;
    return {
      items: items.map((f) => serializeUserSummary(f.follower)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getFollowing(userId: string, opts: { cursor?: string; limit?: number }) {
    const limit = opts.limit ?? 20;
    const follows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      include: { following: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = follows.length > limit;
    const items = hasMore ? follows.slice(0, limit) : follows;
    return {
      items: items.map((f) => serializeUserSummary(f.following)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
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
      hasTelegram: user.telegramId !== null,
      telegramUsername: user.telegramUsername,
      createdAt: user.createdAt.toISOString(),
      followerCount,
      followingCount,
      viewerIsFollowing: viewerId ? Boolean(viewerFollow) : undefined,
      isPremium: user.isPremium,
      nameStyle: user.nameStyle,
      nameColor: user.nameColor,
      ringStyle: user.ringStyle,
      badgeEmoji: user.badgeEmoji,
      stats: {
        ideasSubmittedCount,
        ideasAcceptedCount,
        gamesPlayedCount: scores.length,
        bestScoresByGame: [...bestByGame.values()],
      },
    };
  }
}
