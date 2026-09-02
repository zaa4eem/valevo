import { z } from 'zod';

export const createPostSchema = z.object({
  body: z.string().min(1).max(5000),
  publish: z.boolean().default(true),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  body: z.string().min(1).max(5000).optional(),
  publish: z.boolean().optional(),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const postSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  author: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
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
  author: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});
export type Comment = z.infer<typeof commentSchema>;
