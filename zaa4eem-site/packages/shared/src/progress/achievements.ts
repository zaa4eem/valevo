/**
 * Achievements.
 *
 * Every one of these is a *cumulative* milestone against a counter that only
 * ever goes up. That is a deliberate limit: an achievement must be something
 * a person earns and keeps.
 *
 * Which is exactly why being #1 in a game is NOT here. First place is
 * borrowed, not earned — it moves to whoever plays better this afternoon —
 * and it already has its own display: the live "Топ-1" plate on the profile,
 * which appears and disappears with the leaderboard. Baking it into a
 * permanent collection would either freeze a claim that stopped being true,
 * or make a "permanent" badge that silently vanishes. It stays a plate.
 */

export const ACHIEVEMENT_TIERS = ['BRONZE', 'SILVER', 'GOLD', 'LEGEND'] as const;
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number];

/** Counters an achievement can watch — these mirror the columns on UserProgress. */
export const ACHIEVEMENT_COUNTERS = [
  'postsPublished',
  'commentsWritten',
  'likesReceived',
  'likesGiven',
  'ideasSubmitted',
  'ideasAccepted',
  'ideaVotesCast',
  'gamesPlayed',
  'followersGained',
  'referralsJoined',
  'coinsEarnedTotal',
  'streakBest',
  'level',
] as const;
export type AchievementCounter = (typeof ACHIEVEMENT_COUNTERS)[number];

export interface AchievementDefinition {
  code: string;
  title: string;
  description: string;
  icon: string;
  tier: AchievementTier;
  counter: AchievementCounter;
  threshold: number;
  /** Paid once, when it unlocks. */
  xp: number;
  /** Grouping for the profile's collection view. */
  group: 'Творчество' | 'Общение' | 'Идеи' | 'Игры' | 'Постоянство' | 'Приглашения';
}

const XP_BY_TIER: Record<AchievementTier, number> = {
  BRONZE: 50,
  SILVER: 150,
  GOLD: 400,
  LEGEND: 1200,
};

function make(
  code: string,
  title: string,
  description: string,
  icon: string,
  tier: AchievementTier,
  counter: AchievementCounter,
  threshold: number,
  group: AchievementDefinition['group'],
): AchievementDefinition {
  return { code, title, description, icon, tier, counter, threshold, xp: XP_BY_TIER[tier], group };
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  // --- Творчество ---
  make('first_post', 'Первое слово', 'Опубликовать первый пост', '📝', 'BRONZE', 'postsPublished', 1, 'Творчество'),
  make('posts_10', 'Есть что сказать', 'Опубликовать 10 постов', '🗞️', 'SILVER', 'postsPublished', 10, 'Творчество'),
  make('posts_50', 'Голос площадки', 'Опубликовать 50 постов', '📣', 'GOLD', 'postsPublished', 50, 'Творчество'),
  make('posts_200', 'Летописец', 'Опубликовать 200 постов', '📚', 'LEGEND', 'postsPublished', 200, 'Творчество'),
  make('likes_10', 'Зашло', 'Собрать 10 лайков', '❤️', 'BRONZE', 'likesReceived', 10, 'Творчество'),
  make('likes_100', 'Народный любимец', 'Собрать 100 лайков', '💖', 'SILVER', 'likesReceived', 100, 'Творчество'),
  make('likes_1000', 'Легенда ленты', 'Собрать 1000 лайков', '🔥', 'LEGEND', 'likesReceived', 1000, 'Творчество'),

  // --- Общение ---
  make('comments_10', 'Собеседник', 'Написать 10 комментариев', '💬', 'BRONZE', 'commentsWritten', 10, 'Общение'),
  make('comments_100', 'Душа компании', 'Написать 100 комментариев', '🗣️', 'SILVER', 'commentsWritten', 100, 'Общение'),
  make('comments_500', 'Вечный диалог', 'Написать 500 комментариев', '🎙️', 'GOLD', 'commentsWritten', 500, 'Общение'),
  make('likes_given_50', 'Щедрая душа', 'Поставить 50 лайков', '🤝', 'BRONZE', 'likesGiven', 50, 'Общение'),
  make('likes_given_500', 'Всех поддержу', 'Поставить 500 лайков', '🫶', 'SILVER', 'likesGiven', 500, 'Общение'),
  make('followers_1', 'За вами следят', 'Получить первого подписчика', '👤', 'BRONZE', 'followersGained', 1, 'Общение'),
  make('followers_10', 'Своя аудитория', 'Получить 10 подписчиков', '👥', 'SILVER', 'followersGained', 10, 'Общение'),
  make('followers_50', 'Центр притяжения', 'Получить 50 подписчиков', '🌟', 'GOLD', 'followersGained', 50, 'Общение'),

  // --- Идеи ---
  make('idea_1', 'Есть мысль', 'Предложить первую идею', '💡', 'BRONZE', 'ideasSubmitted', 1, 'Идеи'),
  make('idea_10', 'Генератор идей', 'Предложить 10 идей', '🧠', 'SILVER', 'ideasSubmitted', 10, 'Идеи'),
  make('idea_accepted_1', 'Приняли!', 'Одна из ваших идей принята', '✅', 'SILVER', 'ideasAccepted', 1, 'Идеи'),
  make('idea_accepted_5', 'Соавтор', 'Пять ваших идей приняты', '🏗️', 'GOLD', 'ideasAccepted', 5, 'Идеи'),
  make('idea_votes_10', 'Есть мнение', 'Поддержать 10 идей', '🔺', 'BRONZE', 'ideaVotesCast', 10, 'Идеи'),
  make('idea_votes_100', 'Совесть доски', 'Поддержать 100 идей', '🗳️', 'SILVER', 'ideaVotesCast', 100, 'Идеи'),

  // --- Игры ---
  make('game_1', 'Первый заход', 'Сыграть в любую игру', '🕹️', 'BRONZE', 'gamesPlayed', 1, 'Игры'),
  make('game_25', 'Разогрелся', 'Сыграть 25 раз', '🎮', 'SILVER', 'gamesPlayed', 25, 'Игры'),
  make('game_200', 'Завсегдатай', 'Сыграть 200 раз', '🏅', 'GOLD', 'gamesPlayed', 200, 'Игры'),
  make('coins_1000', 'Первая тысяча', 'Заработать 1 000 Z-коинов', '🪙', 'BRONZE', 'coinsEarnedTotal', 1000, 'Игры'),
  make('coins_10000', 'Кошелёк потяжелел', 'Заработать 10 000 Z-коинов', '💰', 'SILVER', 'coinsEarnedTotal', 10_000, 'Игры'),
  make('coins_100000', 'Монетный двор', 'Заработать 100 000 Z-коинов', '🏦', 'GOLD', 'coinsEarnedTotal', 100_000, 'Игры'),

  // --- Постоянство ---
  make('streak_3', 'Втянулся', 'Заходить 3 дня подряд', '🔥', 'BRONZE', 'streakBest', 3, 'Постоянство'),
  make('streak_7', 'Неделя без пропусков', 'Заходить 7 дней подряд', '📅', 'SILVER', 'streakBest', 7, 'Постоянство'),
  make('streak_30', 'Месяц в строю', 'Заходить 30 дней подряд', '🗓️', 'GOLD', 'streakBest', 30, 'Постоянство'),
  make('streak_100', 'Сто дней', 'Заходить 100 дней подряд', '💎', 'LEGEND', 'streakBest', 100, 'Постоянство'),
  make('level_5', 'Пятый уровень', 'Достичь 5 уровня', '⭐', 'BRONZE', 'level', 5, 'Постоянство'),
  make('level_10', 'Десятый уровень', 'Достичь 10 уровня', '🌠', 'SILVER', 'level', 10, 'Постоянство'),
  make('level_25', 'Двадцать пятый', 'Достичь 25 уровня', '☄️', 'GOLD', 'level', 25, 'Постоянство'),
  make('level_50', 'Полсотни', 'Достичь 50 уровня', '👑', 'LEGEND', 'level', 50, 'Постоянство'),

  // --- Приглашения ---
  make('referral_1', 'Позвал друга', 'Привести одного человека', '📨', 'BRONZE', 'referralsJoined', 1, 'Приглашения'),
  make('referral_3', 'Своя компания', 'Привести трёх человек', '🎊', 'SILVER', 'referralsJoined', 3, 'Приглашения'),
  make('referral_10', 'Амбассадор', 'Привести десять человек', '🚀', 'GOLD', 'referralsJoined', 10, 'Приглашения'),
];

export function achievementByCode(code: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.code === code);
}

/** Achievements watching a given counter, cheapest threshold first. */
export function achievementsForCounter(counter: AchievementCounter): AchievementDefinition[] {
  return ACHIEVEMENTS.filter((a) => a.counter === counter).sort((a, b) => a.threshold - b.threshold);
}

export const ACHIEVEMENT_GROUPS = [
  'Творчество',
  'Общение',
  'Идеи',
  'Игры',
  'Постоянство',
  'Приглашения',
] as const;
