/**
 * The fixed set of games the platform ships with. Upserted idempotently
 * both by GamesService.onModuleInit (every API boot — see the comment
 * there for why) and by prisma/seed.ts (the one-time initial deploy seed),
 * so a single source of truth can't drift between the two.
 */
export const KNOWN_GAMES = [
  {
    slug: 'neon-snake',
    title: 'Neon Snake',
    description: 'Classic snake, zaa4eem style — chase the green, avoid yourself.',
    maxPlausibleScore: 500,
  },
  {
    slug: 'z-clicker',
    title: 'Z-Кликер',
    description: 'Кликай и копи Z-коины — потрать их на апгрейды или на Premium в магазине.',
    // Not a score-based game — this is unused by the clicker's own zCoins
    // leaderboard, just required by the shared Game row shape.
    maxPlausibleScore: 1_000_000,
  },
] as const;
