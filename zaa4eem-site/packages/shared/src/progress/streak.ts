/**
 * Daily streak: consecutive days with at least one visit.
 *
 * The reward is a multiplier on Z-Кликер earnings rather than a flat coin
 * bonus — a multiplier makes the streak worth *keeping*, where a lump sum
 * only makes it worth *starting*.
 */

/** Each day past the first adds this much, until the cap. */
export const STREAK_BONUS_PER_DAY = 0.1;
/** 2× is the ceiling: reached on day 11, so the climb stays visible for a week and a half. */
export const STREAK_MAX_MULTIPLIER = 2;
/** Days at which the streak pays a one-off coin bonus, and what it pays. */
export const STREAK_MILESTONES: { day: number; coins: number; label: string }[] = [
  { day: 3, coins: 50, label: 'Три дня подряд' },
  { day: 7, coins: 150, label: 'Неделя подряд' },
  { day: 14, coins: 400, label: 'Две недели подряд' },
  { day: 30, coins: 1000, label: 'Месяц подряд' },
  { day: 100, coins: 5000, label: 'Сто дней подряд' },
];

/** Multiplier applied to every Z-Кликер payout at this streak length. Rounded to 2 decimals so the UI never shows 1.7000000000000002×. */
export function streakMultiplier(streakDays: number): number {
  if (streakDays <= 1) return 1;
  const raw = 1 + (streakDays - 1) * STREAK_BONUS_PER_DAY;
  return Math.round(Math.min(raw, STREAK_MAX_MULTIPLIER) * 100) / 100;
}

/** The next milestone still ahead, or null once they're all behind. */
export function nextStreakMilestone(streakDays: number) {
  return STREAK_MILESTONES.find((m) => m.day > streakDays) ?? null;
}

/**
 * Premium's "заморозка": one missed day a week doesn't break the streak.
 * It's the single most-requested thing about streaks everywhere they exist,
 * and it's the difference between a streak that motivates and one that
 * punishes — miss a day once and a non-forgiving streak is simply over,
 * along with any reason to come back.
 */
export const FREEZE_COOLDOWN_DAYS = 7;
