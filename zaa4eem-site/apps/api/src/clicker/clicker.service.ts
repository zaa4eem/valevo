import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLICKER_DAILY_CAP,
  PREMIUM_SHOP_PRICE,
  clickerUpgradeCost,
  type ClickResult,
  type ClickerState,
} from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Midnight UTC of "today" — the boundary the daily earn cap resets on. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class ClickerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rolls a user's coinsEarnedToday back to 0 if the stored day has passed —
   * called before every read/write so the cap always reflects "today"
   * without a scheduled job. Returns the row with today's count guaranteed
   * fresh (persisting the reset only when one was actually needed).
   */
  private async ensureFreshDay(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const today = todayUtc();
    if (user.coinsEarnedDay && user.coinsEarnedDay.getTime() === today.getTime()) {
      return user;
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { coinsEarnedToday: 0, coinsEarnedDay: today },
    });
  }

  private toState(user: { zCoins: number; clickPower: number; coinsEarnedToday: number; isPremium: boolean }): ClickerState {
    return {
      zCoins: user.zCoins,
      clickPower: user.clickPower,
      coinsEarnedToday: user.coinsEarnedToday,
      dailyCap: CLICKER_DAILY_CAP,
      nextUpgradeCost: clickerUpgradeCost(user.clickPower),
      isPremium: user.isPremium,
    };
  }

  async getState(userId: string): Promise<ClickerState> {
    const user = await this.ensureFreshDay(userId);
    return this.toState(user);
  }

  /** count = how many taps this batch represents; each tap is worth clickPower coins, capped by what's left of today's budget. */
  async click(userId: string, count: number): Promise<ClickResult> {
    const user = await this.ensureFreshDay(userId);
    const remaining = Math.max(0, CLICKER_DAILY_CAP - user.coinsEarnedToday);
    const requested = count * user.clickPower;
    const awarded = Math.min(requested, remaining);
    const capped = awarded < requested;

    const updated = awarded > 0
      ? await this.prisma.user.update({
          where: { id: userId },
          data: { zCoins: { increment: awarded }, coinsEarnedToday: { increment: awarded } },
        })
      : user;

    return { ...this.toState(updated), awarded, capped };
  }

  async upgrade(userId: string): Promise<ClickerState> {
    const user = await this.ensureFreshDay(userId);
    const cost = clickerUpgradeCost(user.clickPower);
    if (user.zCoins < cost) {
      throw new BadRequestException(`Не хватает Z-коинов — нужно ${cost}`);
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { zCoins: { decrement: cost }, clickPower: { increment: 1 } },
    });
    return this.toState(updated);
  }

  async leaderboard(limit = 20) {
    const top = await this.prisma.user.findMany({
      where: { zCoins: { gt: 0 } },
      orderBy: { zCoins: 'desc' },
      take: limit,
    });
    return top.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      value: user.zCoins,
    }));
  }

  async buyPremium(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.isPremium) {
      throw new ConflictException('У вас уже есть Premium');
    }
    if (user.zCoins < PREMIUM_SHOP_PRICE) {
      throw new BadRequestException(`Не хватает Z-коинов — нужно ${PREMIUM_SHOP_PRICE}`);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { zCoins: { decrement: PREMIUM_SHOP_PRICE }, isPremium: true },
    });
    await this.prisma.moderationLogEntry.create({
      data: { actorId: userId, targetType: 'USER', targetId: userId, action: 'premium:purchased' },
    });
  }
}
