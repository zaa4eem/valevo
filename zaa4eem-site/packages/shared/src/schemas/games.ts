import { z } from 'zod';

export const submitScoreSchema = z.object({
  value: z.number().int().nonnegative().max(1_000_000),
});
export type SubmitScoreInput = z.infer<typeof submitScoreSchema>;

export const gameSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  thumbnailUrl: z.string().nullable(),
});
export type Game = z.infer<typeof gameSchema>;

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  value: z.number().int(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
