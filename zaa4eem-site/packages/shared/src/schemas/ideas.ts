import { z } from 'zod';
import { IdeaStatus, ModerationState } from '../enums';

export const createIdeaSchema = z.object({
  title: z.string().min(4, 'Title is too short').max(120),
  description: z.string().min(10, 'Tell us a bit more').max(2000),
});
export type CreateIdeaInput = z.infer<typeof createIdeaSchema>;

export const ideaStatusValues = Object.values(IdeaStatus) as [string, ...string[]];
export const moderationStateValues = Object.values(ModerationState) as [string, ...string[]];

export const updateIdeaStatusSchema = z.object({
  status: z.enum(ideaStatusValues as [IdeaStatus, ...IdeaStatus[]]),
});
export type UpdateIdeaStatusInput = z.infer<typeof updateIdeaStatusSchema>;

export const updateIdeaModerationSchema = z.object({
  moderationState: z.enum(moderationStateValues as [ModerationState, ...ModerationState[]]),
  reason: z.string().max(500).optional(),
});
export type UpdateIdeaModerationInput = z.infer<typeof updateIdeaModerationSchema>;

export const ideaSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: z.enum(ideaStatusValues as [IdeaStatus, ...IdeaStatus[]]),
  moderationState: z.enum(moderationStateValues as [ModerationState, ...ModerationState[]]),
  voteCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  submitter: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  viewerHasVoted: z.boolean().optional(),
});
export type Idea = z.infer<typeof ideaSchema>;

export const ideasQuerySchema = z.object({
  sort: z.enum(['top', 'new']).default('top'),
  cursor: z.string().optional(),
});
export type IdeasQuery = z.infer<typeof ideasQuerySchema>;
