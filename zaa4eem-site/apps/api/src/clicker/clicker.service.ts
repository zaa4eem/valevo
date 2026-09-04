import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLICKER_DAILY_CAP,
  PREMIUM_SHOP_PRICE,
  clickerUpgradeCost,
  type ClickResult,
  type ClickerState,
} from '@zaa4eem/shared';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from '../common/telegram-notify.service';
import { addMonths, ensurePremiumFresh, grantTrialPremiumIfUnused } from '../common/premium.util';

const PREMIUM_PURCHASE_MONTHS = 1;

/** Midnight UTC of "today" — the boundary the daily earn cap resets on. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class ClickerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: TelegramNotifyService,
  ) {}

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

  private toState(user: User, referralCount = 0): ClickerState {
    return {
      zCoins: user.zCoins,
      clickPower: user.clickPower,
      coinsEarnedToday: user.coinsEarnedToday,
      dailyCap: CLICKER_DAILY_CAP,
      nextUpgradeCost: clickerUpgradeCost(user.clickPower),
      isPremium: user.isPremium,
      premiumUntil: user.premiumUntil?.toISOString() ?? null,
      usedTrialPremium: user.usedTrialPremium,
      referralCode: user.referralCode,
      referralCount,
    };
  }

  async getState(userId: string): Promise<ClickerState> {
    const fresh = await this.ensureFreshDay(userId);
    const [user, referralCount] = await Promise.all([
      ensurePremiumFresh(this.prisma, fresh),
      this.prisma.user.count({ where: { invitedById: userId } }),
    ]);
    return this.toState(user, referralCount);
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

  /**
   * Grants 1 month of Premium for PREMIUM_SHOP_PRICE Z. A repeat purchase
   * stacks — extends premiumUntil forward from wherever it currently is —
   * rather than overwriting, so buying early never wastes remaining time.
   * Blocked only when Premium is already permanent ("Навсегда" owner
   * grant), since extending a grant with no end date makes no sense.
   */
  async buyPremium(userId: string) {
    const raw = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!raw) throw new NotFoundException('Пользователь не найден');
    const user = await ensurePremiumFresh(this.prisma, raw);

    if (user.isPremium && user.premiumUntil === null) {
      throw new ConflictException('У вас уже есть Premium навсегда');
    }
    if (user.zCoins < PREMIUM_SHOP_PRICE) {
      throw new BadRequestException(`Не хватает Z-коинов — нужно ${PREMIUM_SHOP_PRICE}`);
    }

    const base = user.isPremium && user.premiumUntil ? user.premiumUntil : new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        zCoins: { decrement: PREMIUM_SHOP_PRICE },
        isPremium: true,
        premiumUntil: addMonths(base, PREMIUM_PURCHASE_MONTHS),
      },
    });
    await this.prisma.moderationLogEntry.create({
      data: { actorId: userId, targetType: 'USER', targetId: userId, action: 'premium:purchased' },
    });
  }

  /** The Shop's standalone "попробовать бесплатно" button — same one-time 24h trial a first referral grants, whichever the user reaches first. */
  async buyTrial(userId: string): Promise<{ granted: boolean }> {
    const granted = await grantTrialPremiumIfUnused(this.prisma, this.notify, userId);
    return { granted };
  }
}
