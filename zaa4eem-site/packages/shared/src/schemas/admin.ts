import { z } from 'zod';

export const moderationActionSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

export const moderationLogEntrySchema = z.object({
  id: z.string().uuid(),
  actor: z.object({ id: z.string().uuid(), displayName: z.string() }),
  targetType: z.enum(['IDEA', 'POST', 'USER', 'SCORE']),
  targetId: z.string().uuid(),
  action: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type ModerationLogEntry = z.infer<typeof moderationLogEntrySchema>;

export const adminStatsSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  ideasByStatus: z.record(z.string(), z.number().int().nonnegative()),
  ideasPendingModeration: z.number().int().nonnegative(),
  totalGamePlays: z.number().int().nonnegative(),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

export const adminUserListItemSchema = z.object({
  id: z.string().uuid(),
  memberNumber: z.number().int().positive(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['OWNER', 'SUBSCRIBER']),
  status: z.enum(['ACTIVE', 'MUTED', 'BANNED']),
  email: z.string().nullable(),
  telegramUsername: z.string().nullable(),
  followerCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type AdminUserListItem = z.infer<typeof adminUserListItemSchema>;
