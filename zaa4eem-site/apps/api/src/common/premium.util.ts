import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from './telegram-notify.service';

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Lazily expires a time-limited Premium grant — the same pattern
 * ClickerService's ensureFreshDay uses for the daily click cap, applied here
 * to premiumUntil instead. premiumUntil === null means granted forever (an
 * owner "Навсегда" grant), so those never get touched here. Call this
 * wherever a user's Premium fields are read or gate an action, and use the
 * returned (possibly corrected) row from then on.
 */
export async function ensurePremiumFresh(prisma: PrismaService, user: User): Promise<User> {
  if (!user.isPremium || !user.premiumUntil || user.premiumUntil > new Date()) {
    return user;
  }
  return prisma.user.update({
    where: { id: user.id },
    data: {
      isPremium: false,
      nameStyle: null,
      nameColor: null,
      ringStyle: null,
      badgeEmoji: null,
      premiumUntil: null,
    },
  });
}

const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * The one 24h taste of Premium an account ever gets — from a first
 * successful referral (UsersService.attributeReferral) or the Shop's
 * standalone "попробовать бесплатно" button (ShopController), whichever
 * happens first. Comes with a preset style (gold glow + pulsing ring) so
 * the effect is visible immediately instead of requiring setup. Returns
 * false (no-op) if the trial was already used, or Premium is already active.
 */
export async function grantTrialPremiumIfUnused(
  prisma: PrismaService,
  notify: TelegramNotifyService,
  userId: string,
): Promise<boolean> {
  const raw = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const user = await ensurePremiumFresh(prisma, raw);
  if (user.usedTrialPremium || user.isPremium) return false;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      isPremium: true,
      premiumUntil: new Date(Date.now() + TRIAL_DURATION_MS),
      usedTrialPremium: true,
      nameStyle: 'GLOW',
      nameColor: '#facc15',
      ringStyle: 'PULSE',
    },
  });
  if (updated.telegramId) {
    notify
      .notify(updated.telegramId, '👑 Тебе включили Premium на 24 часа — загляни в Настройки, чтобы увидеть эффект!')
      .catch(() => undefined);
  }
  return true;
}
