import { z } from 'zod';
import { premiumFieldsSchema } from './users';

/**
 * What to show when nobody has typed anything yet.
 *
 * The search page used to render an empty shell until the first keystroke,
 * which is the worst possible answer to "what is on this site" — the person
 * most likely to open search is the one who doesn't yet know what to look
 * for.
 */

export const suggestedPersonSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    memberNumber: z.number().int().positive(),
    role: z.enum(['OWNER', 'SUBSCRIBER']),
    followerCount: z.number().int().nonnegative(),
    /** Why this person is being suggested — shown under the name so the list never feels random. */
    reason: z.string(),
    level: z.number().int().positive(),
  })
  // Merged rather than re-declared: PremiumName and PremiumAvatar take the
  // real enums, and a looser `string | null` copy of these fields here would
  // make a suggested person the one kind of user those components can't render.
  .merge(premiumFieldsSchema.omit({ premiumUntil: true }));
export type SuggestedPerson = z.infer<typeof suggestedPersonSchema>;

export const trendingPostSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  imageUrl: z.string().nullable(),
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  author: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});
export type TrendingPost = z.infer<typeof trendingPostSchema>;

export const trendingIdeaSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  voteCount: z.number().int().nonnegative(),
});
export type TrendingIdea = z.infer<typeof trendingIdeaSchema>;

export const discoverSchema = z.object({
  people: z.array(suggestedPersonSchema),
  posts: z.array(trendingPostSchema),
  ideas: z.array(trendingIdeaSchema),
});
export type Discover = z.infer<typeof discoverSchema>;
