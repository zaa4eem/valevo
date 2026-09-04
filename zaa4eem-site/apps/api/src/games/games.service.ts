import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ScoreReviewState } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { KNOWN_GAMES } from './known-games';

@Injectable()
export class GamesService implements OnModuleInit {
  private readonly logger = new Logger(GamesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Self-heals a deployment whose database predates a game being added to
   * KNOWN_GAMES (or whose seed script simply never got re-run after a
   * feature update) — without this, a new game's page 404s forever with
   * "Не удалось загрузить игру" until someone remembers to run
   * `prisma:seed` by hand. Runs on every boot; upsert is a no-op once the
   * row already exists, so this is safe to repeat indefinitely.
   */
  async onModuleInit() {
    for (const game of KNOWN_GAMES) {
      await this.prisma.game
        .upsert({ where: { slug: game.slug }, update: {}, create: game })
        .catch((err) => {
          this.logger.warn(`Could not ensure game "${game.slug}" exists: ${err instanceof Error ? err.message : err}`);
        });
    }
  }

  async listActive() {
    const games = await this.prisma.game.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return games.map(serializeGame);
  }

  async getBySlug(slug: string) {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game) throw new NotFoundException('Игра не найдена');
    return serializeGame(game);
  }

  async submitScore(slug: string, userId: string, value: number) {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game) throw new NotFoundException('Игра не найдена');

    const reviewState =
      value > game.maxPlausibleScore ? ScoreReviewState.HELD_FOR_REVIEW : ScoreReviewState.NORMAL;

    return this.prisma.score.create({
      data: { gameId: game.id, userId, value, reviewState },
    });
  }

  async leaderboardForGame(slug: string, limit = 20) {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game) throw new NotFoundException('Игра не найдена');

    // Best NORMAL score per user for this game.
    const scores = await this.prisma.score.findMany({
      where: { gameId: game.id, reviewState: ScoreReviewState.NORMAL },
      include: { user: true },
      orderBy: { value: 'desc' },
    });

    const bestPerUser = new Map<string, (typeof scores)[number]>();
    for (const score of scores) {
      const existing = bestPerUser.get(score.userId);
      if (!existing || score.value > existing.value) {
        bestPerUser.set(score.userId, score);
      }
    }

    return [...bestPerUser.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((score, index) => ({
        rank: index + 1,
        userId: score.userId,
        displayName: score.user.displayName,
        avatarUrl: score.user.avatarUrl,
        value: score.value,
      }));
  }

  async globalLeaderboard(limit = 20) {
    const scores = await this.prisma.score.findMany({
      where: { reviewState: ScoreReviewState.NORMAL },
      include: { user: true },
    });

    // Global = sum of each user's best score per game.
    const bestPerUserPerGame = new Map<string, number>();
    const userMeta = new Map<string, { displayName: string; avatarUrl: string | null }>();
    for (const score of scores) {
      const key = `${score.userId}:${score.gameId}`;
      const current = bestPerUserPerGame.get(key) ?? 0;
      if (score.value > current) bestPerUserPerGame.set(key, score.value);
      userMeta.set(score.userId, {
        displayName: score.user.displayName,
        avatarUrl: score.user.avatarUrl,
      });
    }

    const totals = new Map<string, number>();
    for (const [key, value] of bestPerUserPerGame.entries()) {
      const userId = key.split(':')[0];
      totals.set(userId, (totals.get(userId) ?? 0) + value);
    }

    return [...totals.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([userId, value], index) => ({
        rank: index + 1,
        userId,
        displayName: userMeta.get(userId)?.displayName ?? 'Unknown',
        avatarUrl: userMeta.get(userId)?.avatarUrl ?? null,
        value,
      }));
  }
}

function serializeGame(game: { slug: string; title: string; description: string; thumbnailUrl: string | null }) {
  return {
    slug: game.slug,
    title: game.title,
    description: game.description,
    thumbnailUrl: game.thumbnailUrl,
  };
}
