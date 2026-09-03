import { z } from 'zod';

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(60).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  statusText: z.string().max(80).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const publicProfileSchema = z.object({
  id: z.string().uuid(),
  memberNumber: z.number().int().positive(),
  role: z.enum(['OWNER', 'SUBSCRIBER']),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  statusText: z.string().nullable(),
  createdAt: z.string(),
  followerCount: z.number().int().nonnegative(),
  followingCount: z.number().int().nonnegative(),
  viewerIsFollowing: z.boolean().optional(),
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

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  memberNumber: z.number().int().positive(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['OWNER', 'SUBSCRIBER']),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const paginatedUserSummariesSchema = z.object({
  items: z.array(userSummarySchema),
  nextCursor: z.string().uuid().nullable(),
});
export type PaginatedUserSummaries = z.infer<typeof paginatedUserSummariesSchema>;

export const userListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** "#0001" style member tag. Range is a display convention (4 digits), not a hard cap — the sequence keeps counting past 9999. */
export function formatMemberNumber(memberNumber: number): string {
  return `#${String(memberNumber).padStart(4, '0')}`;
}
