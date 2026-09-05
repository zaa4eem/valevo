import { z } from 'zod';
import { ACHIEVEMENT_TIERS } from '../progress/achievements';

export const levelStateSchema = z.object({
  level: z.number().int().min(1),
  xp: z.number().int().nonnegative(),
  xpIntoLevel: z.number().int().nonnegative(),
  xpForNextLevel: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
});
export type LevelState = z.infer<typeof levelStateSchema>;

export const streakStateSchema = z.object({
  days: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  multiplier: z.number(),
  /** True once today's visit is counted — the flame is lit rather than at risk. */
  countedToday: z.boolean(),
  /** Premium only: whether a missed day would currently be forgiven. */
  freezeAvailable: z.boolean(),
  nextMilestone: z
    .object({ day: z.number().int(), coins: z.number().int(), label: z.string() })
    .nullable(),
});
export type StreakState = z.infer<typeof streakStateSchema>;

export const questStateSchema = z.object({
  code: z.string(),
  title: z.string(),
  icon: z.string(),
  href: z.string(),
  progress: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  coins: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
  done: z.boolean(),
  claimed: z.boolean(),
});
export type QuestState = z.infer<typeof questStateSchema>;

export const achievementStateSchema = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  tier: z.enum(ACHIEVEMENT_TIERS),
  group: z.string(),
  threshold: z.number().int().positive(),
  progress: z.number().int().nonnegative(),
  unlocked: z.boolean(),
  unlockedAt: z.string().nullable(),
  xp: z.number().int().nonnegative(),
});
export type AchievementState = z.infer<typeof achievementStateSchema>;

export const onboardingStateSchema = z.object({
  /** Hidden once finished (or once the reward was already taken). */
  active: z.boolean(),
  completed: z.boolean(),
  rewardClaimed: z.boolean(),
  steps: z.array(
    z.object({
      code: z.string(),
      title: z.string(),
      hint: z.string(),
      icon: z.string(),
      href: z.string(),
      done: z.boolean(),
    }),
  ),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const referralGoalStateSchema = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  invites: z.number().int().positive(),
  progress: z.number().int().nonnegative(),
  coins: z.number().int().nonnegative(),
  premiumDays: z.number().int().nonnegative(),
  reached: z.boolean(),
  claimed: z.boolean(),
});
export type ReferralGoalState = z.infer<typeof referralGoalStateSchema>;

export const seasonStateSchema = z.object({
  index: z.number().int().positive(),
  startsAt: z.string(),
  endsAt: z.string(),
  daysLeft: z.number().int().nonnegative(),
  /** XP earned inside this season only — the leaderboard everyone starts level with. */
  xp: z.number().int().nonnegative(),
  rank: z.number().int().positive().nullable(),
});
export type SeasonState = z.infer<typeof seasonStateSchema>;

/** Everything the progress screen needs, in one round trip. */
export const progressStateSchema = z.object({
  level: levelStateSchema,
  streak: streakStateSchema,
  quests: z.array(questStateSchema),
  season: seasonStateSchema,
  onboarding: onboardingStateSchema,
  referralGoals: z.array(referralGoalStateSchema),
  achievementsUnlocked: z.number().int().nonnegative(),
  achievementsTotal: z.number().int().positive(),
});
export type ProgressState = z.infer<typeof progressStateSchema>;

export const claimQuestSchema = z.object({ code: z.string().min(1).max(64) });
export type ClaimQuestInput = z.infer<typeof claimQuestSchema>;

/** What a claim paid out, so the UI can celebrate the exact numbers. */
export const claimRewardSchema = z.object({
  coins: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
  premiumDays: z.number().int().nonnegative(),
});
export type ClaimReward = z.infer<typeof claimRewardSchema>;

export const seasonLeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  xp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
});
export type SeasonLeaderboardEntry = z.infer<typeof seasonLeaderboardEntrySchema>;
