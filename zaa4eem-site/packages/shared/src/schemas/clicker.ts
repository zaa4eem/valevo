import { z } from 'zod';

// No offline/idle production by design — clickPower only raises the coins
// earned per manual click, so the daily cap is what actually limits how much
// a single user can farm, not how long they leave a tab open.
export const CLICKER_DAILY_CAP = 2000;

/**
 * The daily streak scales both the per-tap payout AND the cap by the same
 * factor. Scaling only the payout would hand a streak nothing at all —
 * the cap would still bind at the same total, so the reward would be
 * "reach the same ceiling with fewer taps", which nobody notices. Scaling
 * both means a kept streak genuinely earns more per day.
 */
export function effectiveDailyCap(multiplier: number): number {
  return Math.floor(CLICKER_DAILY_CAP * multiplier);
}
export const CLICKER_UPGRADE_BASE_COST = 10;
export const CLICKER_UPGRADE_GROWTH = 1.15;
export const PREMIUM_SHOP_PRICE = 22222;

/** cost to go from clickPower -> clickPower + 1 */
export function clickerUpgradeCost(clickPower: number): number {
  return Math.round(CLICKER_UPGRADE_BASE_COST * CLICKER_UPGRADE_GROWTH ** (clickPower - 1));
}

export const clickerStateSchema = z.object({
  zCoins: z.number().int().nonnegative(),
  clickPower: z.number().int().positive(),
  coinsEarnedToday: z.number().int().nonnegative(),
  dailyCap: z.number().int().positive(),
  nextUpgradeCost: z.number().int().positive(),
  isPremium: z.boolean(),
  premiumUntil: z.string().nullable(),
  usedTrialPremium: z.boolean(),
  referralCode: z.string(),
  referralCount: z.number().int().nonnegative(),
  /// Streak bonus currently in force. 1 means no streak; see progress/streak.ts.
  streakMultiplier: z.number(),
  streakDays: z.number().int().nonnegative(),
});
export type ClickerState = z.infer<typeof clickerStateSchema>;

export const clickBatchSchema = z.object({
  // A client batches rapid taps and flushes every ~500ms rather than firing
  // one request per tap — 50 is generous headroom over any human clicking
  // speed at that interval, not a real anti-cheat boundary (the daily cap is).
  count: z.number().int().min(1).max(50),
});
export type ClickBatchInput = z.infer<typeof clickBatchSchema>;

export const clickResultSchema = clickerStateSchema.extend({
  awarded: z.number().int().nonnegative(),
  capped: z.boolean(),
});
export type ClickResult = z.infer<typeof clickResultSchema>;
