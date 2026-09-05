/**
 * XP and levels.
 *
 * The curve is quadratic: each level costs `LEVEL_STEP` more XP than the
 * one before it. That keeps the first handful of levels within reach of a
 * single evening (which is the point — a brand-new account should see the
 * number move) while level 50 still means something.
 *
 * Cumulative XP needed to *reach* level L is LEVEL_STEP * L * (L - 1) / 2,
 * so level 2 costs 100, level 3 another 200, level 10 sits at 4 500 total.
 */
export const LEVEL_STEP = 100;
export const MAX_LEVEL = 100;

/** Total XP needed to have reached this level. Level 1 starts at 0. */
export function xpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return (LEVEL_STEP * clamped * (clamped - 1)) / 2;
}

/** The level a given lifetime XP total corresponds to. Inverse of xpForLevel. */
export function levelFromXp(xp: number): number {
  if (xp <= 0) return 1;
  // Solving LEVEL_STEP * L * (L - 1) / 2 <= xp for L.
  const level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / LEVEL_STEP)) / 2);
  return Math.max(1, Math.min(MAX_LEVEL, level));
}

/** Everything the UI needs to draw a progress bar, computed in one place so the API and the web app can never disagree. */
export function levelProgress(xp: number): {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  /** 0..1; exactly 1 at MAX_LEVEL, where there is no next level to fill towards. */
  fraction: number;
} {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) {
    return { level, xp, xpIntoLevel: 0, xpForNextLevel: 0, fraction: 1 };
  }
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const xpIntoLevel = xp - floor;
  const xpForNextLevel = ceiling - floor;
  return {
    level,
    xp,
    xpIntoLevel,
    xpForNextLevel,
    fraction: xpForNextLevel === 0 ? 1 : xpIntoLevel / xpForNextLevel,
  };
}

/**
 * XP each tracked action is worth. Deliberately lopsided: writing something
 * (a post, an idea) pays far more than reacting to something, because the
 * scarce thing on a small platform is people who make things, not people
 * who tap hearts.
 */
export const XP_BY_EVENT = {
  POST_PUBLISHED: 25,
  COMMENT_WRITTEN: 8,
  LIKE_RECEIVED: 3,
  LIKE_GIVEN: 1,
  IDEA_SUBMITTED: 30,
  IDEA_ACCEPTED: 120,
  IDEA_VOTED: 2,
  GAME_PLAYED: 6,
  FOLLOWER_GAINED: 10,
  FOLLOW_MADE: 2,
  REFERRAL_JOINED: 150,
  DAILY_CHECKIN: 15,
  /// Counter-only: Z-coins are already their own reward, so earning them pays no XP on top.
  COINS_EARNED: 0,
} as const;

export type ProgressEvent = keyof typeof XP_BY_EVENT;
export const progressEventValues = Object.keys(XP_BY_EVENT) as ProgressEvent[];
