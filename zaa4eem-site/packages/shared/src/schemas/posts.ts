import { z } from 'zod';
import { premiumFieldsSchema } from './users';
import { ModerationState } from '../enums';

const moderationStateValues = Object.values(ModerationState) as [ModerationState, ...ModerationState[]];

export const createPostSchema = z.object({
  body: z.string().min(1).max(5000),
  publish: z.boolean().default(true),
  // Set only after a prior upload to POST /posts/me/image — the image itself
  // never travels through this JSON endpoint, just its resulting URL.
  // Restricted to http(s): z.string().url() alone accepts any URL scheme
  // (javascript:, data:, ...), and nothing else here re-checks that this
  // was actually a URL we issued.
  imageUrl: z.string().url().refine((v) => /^https?:\/\//i.test(v), 'URL должен начинаться с http:// или https://').optional(),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  body: z.string().min(1).max(5000).optional(),
  publish: z.boolean().optional(),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const updatePostModerationSchema = z.object({
  moderationState: z.enum(moderationStateValues),
  reason: z.string().max(500).optional(),
});
export type UpdatePostModerationInput = z.infer<typeof updatePostModerationSchema>;

export const postSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  imageUrl: z.string().nullable(),
  moderationState: z.enum(['CLEAN', 'PENDING_REVIEW', 'APPROVED', 'REMOVED']),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  author: z
    .object({
      id: z.string().uuid(),
      memberNumber: z.number().int().positive(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      role: z.enum(['OWNER', 'SUBSCRIBER']),
      viewerIsFollowing: z.boolean().optional(),
    })
    .merge(premiumFieldsSchema),
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  viewerHasLiked: z.boolean().optional(),
});
export type Post = z.infer<typeof postSchema>;

export const createCommentSchema = z.object({
  body: z.string().min(1).max(1000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const commentSchema = z.object({
  id: z.string().uuid(),
  postId: z.string().uuid(),
  body: z.string(),
  moderationState: z.enum(['CLEAN', 'PENDING_REVIEW', 'APPROVED', 'REMOVED']),
  createdAt: z.string(),
  author: z
    .object({
      id: z.string().uuid(),
      memberNumber: z.number().int().positive(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
    })
    .merge(premiumFieldsSchema),
});
export type Comment = z.infer<typeof commentSchema>;

export const postsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PostsQuery = z.infer<typeof postsQuerySchema>;

export const paginatedPostsSchema = z.object({
  items: z.array(postSchema),
  nextCursor: z.string().uuid().nullable(),
});
export type PaginatedPosts = z.infer<typeof paginatedPostsSchema>;
