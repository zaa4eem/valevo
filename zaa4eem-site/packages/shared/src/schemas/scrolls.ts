import { z } from 'zod';
import { premiumFieldsSchema } from './users';

/**
 * Scrolls — the vertical, one-clip-at-a-time video feed.
 *
 * Every clip is watched by a human before anyone else can see it. That is a
 * deliberate constraint, not a placeholder for "automate this later": video
 * is the one format where a single unreviewed upload can do real harm to a
 * small platform, and at this size a person can genuinely watch everything.
 */

export const scrollStatusValues = [
  /** Uploaded; ffmpeg is still turning it into something every phone can play. */
  'PROCESSING',
  /** Transcoded and waiting for a human. */
  'PENDING_REVIEW',
  'PUBLISHED',
  'REJECTED',
  /** The file could not be read as a video at all. */
  'FAILED',
] as const;
export type ScrollStatus = (typeof scrollStatusValues)[number];

/** Hard caps, enforced on both sides — the server's is the one that counts. */
export const SCROLL_MAX_BYTES = 80 * 1024 * 1024;
export const SCROLL_MAX_DURATION_S = 90;
export const SCROLL_MAX_CAPTION = 300;
export const SCROLL_MAX_COMMENT = 500;
/** Clips are re-encoded down to this height; vertical phone video is the shape this feed is built for. */
export const SCROLL_TARGET_HEIGHT = 1280;

export const createScrollSchema = z.object({
  caption: z.string().max(SCROLL_MAX_CAPTION).default(''),
});
export type CreateScrollInput = z.infer<typeof createScrollSchema>;

export const scrollCommentSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  createdAt: z.string(),
  author: z
    .object({
      id: z.string().uuid(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
    })
    .merge(premiumFieldsSchema.omit({ premiumUntil: true })),
});
export type ScrollComment = z.infer<typeof scrollCommentSchema>;

export const createScrollCommentSchema = z.object({
  body: z.string().trim().min(1, 'Напишите что-нибудь').max(SCROLL_MAX_COMMENT),
});
export type CreateScrollCommentInput = z.infer<typeof createScrollCommentSchema>;

export const scrollSchema = z.object({
  id: z.string().uuid(),
  videoUrl: z.string(),
  posterUrl: z.string(),
  caption: z.string(),
  durationMs: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  viewerHasLiked: z.boolean(),
  createdAt: z.string(),
  author: z
    .object({
      id: z.string().uuid(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      viewerIsFollowing: z.boolean(),
    })
    .merge(premiumFieldsSchema.omit({ premiumUntil: true })),
});
export type Scroll = z.infer<typeof scrollSchema>;

export const paginatedScrollsSchema = z.object({
  items: z.array(scrollSchema),
  nextCursor: z.string().uuid().nullable(),
});
export type PaginatedScrolls = z.infer<typeof paginatedScrollsSchema>;

export const scrollFeedQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});
export type ScrollFeedQuery = z.infer<typeof scrollFeedQuerySchema>;

/** One of your own uploads, including the ones nobody else can see yet. */
export const myScrollSchema = scrollSchema.extend({
  status: z.enum(scrollStatusValues),
  rejectionReason: z.string().nullable(),
});
export type MyScroll = z.infer<typeof myScrollSchema>;

/** The moderation queue's view — same clip, plus who uploaded it. */
export const pendingScrollSchema = myScrollSchema.extend({
  authorEmail: z.string().nullable(),
});
export type PendingScroll = z.infer<typeof pendingScrollSchema>;

export const reviewScrollSchema = z.object({
  approve: z.boolean(),
  /** Shown to the uploader, so a rejection is never a silent disappearance. */
  reason: z.string().max(300).optional(),
});
export type ReviewScrollInput = z.infer<typeof reviewScrollSchema>;
