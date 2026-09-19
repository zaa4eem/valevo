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
    slug: 'neon-arkanoid',
    title: 'Neon Arkanoid',
    description: 'Отбивай шар, ломай блоки. Каждый уровень плотнее и быстрее предыдущего.',
    // Reachable only by clearing a lot of levels: a level is worth its own
    // number × 100 plus 10 a brick, so this is roughly level 12-15 of real
    // play. Above it the score is held for review rather than rejected.
    maxPlausibleScore: 20_000,
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
