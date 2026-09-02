import { z } from 'zod';

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(60).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const publicProfileSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['OWNER', 'SUBSCRIBER']),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  createdAt: z.string(),
  stats: z.object({
    ideasSubmittedCount: z.number().int().nonnegative(),
    ideasAcceptedCount: z.number().int().nonnegative(),
    gamesPlayedCount: z.number().int().nonnegative(),
    bestScoresByGame: z.array(
      z.object({ gameSlug: z.string(), gameTitle: z.string(), value: z.number().int() }),
    ),
  }),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;
