import { z } from 'zod';

/** Owner-only — crediting someone's real-world (outside-the-app) idea that shipped as a feature. */
export const createIdeaCreditSchema = z.object({
  userId: z.string().uuid(),
  description: z.string().min(1).max(300),
});
export type CreateIdeaCreditInput = z.infer<typeof createIdeaCreditSchema>;

export const ideaCreditSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  createdAt: z.string(),
  user: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});
export type IdeaCredit = z.infer<typeof ideaCreditSchema>;

/** The badge-facing shape — no user field, since it's always attached to a profile that's already identified. */
export const profileIdeaCreditSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  createdAt: z.string(),
});
export type ProfileIdeaCredit = z.infer<typeof profileIdeaCreditSchema>;
