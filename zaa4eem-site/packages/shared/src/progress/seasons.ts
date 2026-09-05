/**
 * Seasons: four-week blocks with their own XP leaderboard.
 *
 * A season number is *computed* from the calendar, not stored — there is no
 * job to run, no row to create, and no way for the API and the web app to
 * disagree about which season it is. Season 1 starts at SEASON_EPOCH.
 */
export const SEASON_LENGTH_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SEASON_LENGTH_MS = SEASON_LENGTH_DAYS * DAY_MS;

/**
 * Monday 00:00 UTC, 2026-08-31 — the Monday on or before this feature
 * shipped, so season 1 is already running the day it goes live rather than
 * showing a countdown to a season nobody is in yet.
 */
export const SEASON_EPOCH = Date.UTC(2026, 7, 31);

export interface SeasonInfo {
  /** 1-based. Anything before the epoch is season 1, which simply hasn't started counting yet. */
  index: number;
  startsAt: string;
  endsAt: string;
  /** Whole days left, rounded up — "остался 1 день" should show on the final day, not "0". */
  daysLeft: number;
}

export function seasonAt(now: Date = new Date()): SeasonInfo {
  const elapsed = now.getTime() - SEASON_EPOCH;
  const index = elapsed < 0 ? 1 : Math.floor(elapsed / SEASON_LENGTH_MS) + 1;
  const startsAt = SEASON_EPOCH + (index - 1) * SEASON_LENGTH_MS;
  const endsAt = startsAt + SEASON_LENGTH_MS;
  return {
    index,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    // Clamped to the season's own length: a clock set before the epoch would
    // otherwise report more days remaining than a season actually lasts.
    daysLeft: Math.min(
      SEASON_LENGTH_DAYS,
      Math.max(0, Math.ceil((endsAt - now.getTime()) / DAY_MS)),
    ),
  };
}
