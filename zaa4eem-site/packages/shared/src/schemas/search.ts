import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Введите запрос для поиска').max(200),
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
