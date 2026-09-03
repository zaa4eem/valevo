import { z } from 'zod';
import { premiumBadgeEmojiValues, premiumFieldsSchema, premiumNameStyleValues, premiumRingStyleValues } from './users';

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

/** One day's bucket in the growth/activity time series (`stats().userGrowth` / `.activity`). */
export const adminDailyCountSchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
});
export type AdminDailyCount = z.infer<typeof adminDailyCountSchema>;

/** One day's bucket of platform activity (new posts/ideas/game scores) for the activity chart. */
export const adminDailyActivitySchema = z.object({
  date: z.string(),
  posts: z.number().int().nonnegative(),
  ideas: z.number().int().nonnegative(),
  scores: z.number().int().nonnegative(),
});
export type AdminDailyActivity = z.infer<typeof adminDailyActivitySchema>;

export const adminStatsSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  ideasByStatus: z.record(z.string(), z.number().int().nonnegative()),
  ideasPendingModeration: z.number().int().nonnegative(),
  totalGamePlays: z.number().int().nonnegative(),
  /** Daily new-user counts for roughly the last 30 days, oldest first, zero-filled. */
  userGrowth: z.array(adminDailyCountSchema),
  /** Daily new posts/ideas/game-scores for roughly the last 30 days, oldest first, zero-filled. */
  activity: z.array(adminDailyActivitySchema),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

export const adminUserListItemSchema = z
  .object({
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
  })
  .merge(premiumFieldsSchema);
export type AdminUserListItem = z.infer<typeof adminUserListItemSchema>;

/** Owner-only Premium grant/config — never self-service, hence no "self" variant of this schema. */
export const setPremiumSchema = z.object({
  isPremium: z.boolean(),
  nameStyle: z.enum(premiumNameStyleValues).nullable().optional(),
  nameColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Цвет должен быть в формате #RRGGBB')
    .nullable()
    .optional(),
  ringStyle: z.enum(premiumRingStyleValues).nullable().optional(),
  badgeEmoji: z.enum(premiumBadgeEmojiValues).nullable().optional(),
});
export type SetPremiumInput = z.infer<typeof setPremiumSchema>;
