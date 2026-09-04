import { z } from 'zod';

export const searchTypeValues = ['all', 'users', 'posts', 'ideas'] as const;
export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Введите запрос для поиска').max(200),
  // Filtering to one section skips fetching the other two entirely (see
  // SearchService), so it isn't just a client-side view of the same
  // capped 8-per-category results — it actually returns more of the
  // section you asked for.
  type: z.enum(searchTypeValues).default('all'),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultsSchema = z.object({
  users: z.array(
    z.object({
      id: z.string().uuid(),
      memberNumber: z.number().int().positive(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      role: z.enum(['OWNER', 'SUBSCRIBER']),
    }),
  ),
  posts: z.array(
    z.object({
      id: z.string().uuid(),
      body: z.string(),
      author: z.object({
        id: z.string().uuid(),
        displayName: z.string(),
        avatarUrl: z.string().nullable(),
      }),
    }),
  ),
  ideas: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      description: z.string(),
      status: z.string(),
    }),
  ),
});
export type SearchResults = z.infer<typeof searchResultsSchema>;
