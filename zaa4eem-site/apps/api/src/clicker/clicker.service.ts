import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PREMIUM_SHOP_PRICE,
  clickerUpgradeCost,
  effectiveDailyCap,
  streakMultiplier,
  type ClickResult,
  type ClickerState,
} from '@zaa4eem/shared';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from '../common/telegram-notify.service';
import { addMonths, ensurePremiumFresh, grantTrialPremiumIfUnused } from '../common/premium.util';
import { ProgressService } from '../progress/progress.service';

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
    private readonly progress: ProgressService,
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

  private toState(user: User, referralCount = 0, streakDays = 0): ClickerState {
    const multiplier = streakMultiplier(streakDays);
    return {
      zCoins: user.zCoins,
      clickPower: user.clickPower,
      coinsEarnedToday: user.coinsEarnedToday,
      dailyCap: effectiveDailyCap(multiplier),
      streakMultiplier: multiplier,
      streakDays,
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
    const [user, referralCount, progress] = await Promise.all([
      ensurePremiumFresh(this.prisma, fresh),
      this.prisma.user.count({ where: { invitedById: userId } }),
      this.progress.getRow(userId),
    ]);
    return this.toState(user, referralCount, progress?.streakDays ?? 0);
  }

  /**
   * count = how many taps this batch represents; each tap is worth
   * clickPower coins, capped by what's left of today's budget.
   *
   * The cap is enforced with an optimistic-concurrency retry (guard the
   * write on the exact coinsEarnedToday snapshot we computed `awarded`
   * from, via updateMany + count check) rather than a plain read-then-write
   * — two concurrent batches reading the same "remaining" snapshot could
   * otherwise both be awarded up to it, blowing past the day's cap.
   */
  async click(userId: string, count: number): Promise<ClickResult> {
    let user = await this.ensureFreshDay(userId);
    // Tapping is activity, so it also keeps the streak alive — and the
    // streak it keeps alive is the one being read here for the multiplier.
    const streak = await this.progress.touchStreak(userId).catch(() => null);
    const streakDays = streak?.streakDays ?? 0;
    const multiplier = streakMultiplier(streakDays);
    const cap = effectiveDailyCap(multiplier);
    const requested = Math.round(count * user.clickPower * multiplier);

    for (let attempt = 0; attempt < 5; attempt++) {
      const remaining = Math.max(0, cap - user.coinsEarnedToday);
      const awarded = Math.min(requested, remaining);
      const capped = awarded < requested;
      if (awarded === 0) {
        return { ...this.toState(user, 0, streakDays), awarded: 0, capped };
      }

      const result = await this.prisma.user.updateMany({
        where: { id: userId, coinsEarnedToday: user.coinsEarnedToday },
        data: { zCoins: { increment: awarded }, coinsEarnedToday: { increment: awarded } },
      });
      if (result.count === 1) {
        const updated = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        this.progress.record(userId, 'COINS_EARNED', awarded).catch(() => undefined);
        return { ...this.toState(updated, 0, streakDays), awarded, capped };
      }
      // Another request updated coinsEarnedToday between our read and
      // write — re-read the real current value and recompute against it.
      user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    }
    throw new ConflictException('Слишком много одновременных запросов — попробуйте ещё раз');
  }

  /**
   * Same optimistic-concurrency pattern as click() — the cost is computed
   * from clickPower, so the write is guarded on the exact clickPower we
   * priced it against (plus a balance floor), and retried against a fresh
   * read on conflict. Otherwise several concurrent upgrade calls would all
   * price themselves off the same stale (cheapest) clickPower and all
   * succeed at that price instead of the correct escalating cost.
   */
  async upgrade(userId: string): Promise<ClickerState> {
    let user = await this.ensureFreshDay(userId);

    for (let attempt = 0; attempt < 5; attempt++) {
      const cost = clickerUpgradeCost(user.clickPower);
      if (user.zCoins < cost) {
        throw new BadRequestException(`Не хватает Z-коинов — нужно ${cost}`);
      }

      const result = await this.prisma.user.updateMany({
        where: { id: userId, clickPower: user.clickPower, zCoins: { gte: cost } },
        data: { zCoins: { decrement: cost }, clickPower: { increment: 1 } },
      });
      if (result.count === 1) {
        const updated = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        return this.toState(updated);
      }
      user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    }
    throw new ConflictException('Слишком много одновременных запросов — попробуйте ещё раз');
  }

  async leaderboard(limit = 20) {
    const top = await this.prisma.user.findMany({
      where: { zCoins: { gt: 0 } },
      // zCoins is a live balance with no "achieved at" timestamp to tiebreak
      // on (unlike a game Score row) — memberNumber asc (earliest account)
      // is an arbitrary but deterministic tiebreak, so rank #1 on an exact
      // tie never depends on Postgres' unspecified return order (the
      // "Топ-1 Z-Кликер" profile badge needs this to be unambiguous).
      orderBy: [{ zCoins: 'desc' }, { memberNumber: 'asc' }],
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
   *
   * The write is guarded on the exact premiumUntil we computed `base`
   * from (plus a balance floor) and retried on conflict — two
   * near-simultaneous purchases (e.g. a double-tapped "Купить" button)
   * would otherwise both charge zCoins but both extend from the same
   * stale premiumUntil, so the user pays twice but only one month of
   * Premium is actually added.
   */
  async buyPremium(userId: string) {
    let raw = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!raw) throw new NotFoundException('Пользователь не найден');

    for (let attempt = 0; attempt < 5; attempt++) {
      const user = await ensurePremiumFresh(this.prisma, raw);

      if (user.isPremium && user.premiumUntil === null) {
        throw new ConflictException('У вас уже есть Premium навсегда');
      }
      if (user.zCoins < PREMIUM_SHOP_PRICE) {
        throw new BadRequestException(`Не хватает Z-коинов — нужно ${PREMIUM_SHOP_PRICE}`);
      }

      const base = user.isPremium && user.premiumUntil ? user.premiumUntil : new Date();
      const result = await this.prisma.user.updateMany({
        where: { id: userId, premiumUntil: user.premiumUntil, zCoins: { gte: PREMIUM_SHOP_PRICE } },
        data: {
          zCoins: { decrement: PREMIUM_SHOP_PRICE },
          isPremium: true,
          premiumUntil: addMonths(base, PREMIUM_PURCHASE_MONTHS),
        },
      });
      if (result.count === 1) {
        await this.prisma.moderationLogEntry.create({
          data: { actorId: userId, targetType: 'USER', targetId: userId, action: 'premium:purchased' },
        });
        return;
      }
      raw = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    }
    throw new ConflictException('Слишком много одновременных запросов — попробуйте ещё раз');
  }

  /** The Shop's standalone "попробовать бесплатно" button — same one-time 24h trial a first referral grants, whichever the user reaches first. */
  async buyTrial(userId: string): Promise<{ granted: boolean }> {
    const granted = await grantTrialPremiumIfUnused(this.prisma, this.notify, userId);
    return { granted };
  }
}
