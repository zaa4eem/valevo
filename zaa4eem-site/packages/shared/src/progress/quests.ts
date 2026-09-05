import type { ProgressEvent } from './levels';

/**
 * Daily quests: three small, same-day goals, drawn from this pool by a hash
 * of (user, date) so the set is stable all day and differs between people.
 *
 * Everything here is reachable in one sitting without grinding — a quest
 * someone can't finish today is a quest that makes them feel behind rather
 * than invited.
 */
export interface QuestDefinition {
  code: string;
  title: string;
  /** What action moves the needle. */
  event: ProgressEvent;
  target: number;
  /** Reward, paid on claim. */
  coins: number;
  xp: number;
  icon: string;
  /** Where the "выполнить" button sends someone who hasn't started. */
  href: string;
}

export const QUEST_POOL: QuestDefinition[] = [
  { code: 'daily_post', title: 'Опубликовать пост', event: 'POST_PUBLISHED', target: 1, coins: 60, xp: 30, icon: '📝', href: '/' },
  { code: 'daily_comment_2', title: 'Написать 2 комментария', event: 'COMMENT_WRITTEN', target: 2, coins: 40, xp: 20, icon: '💬', href: '/' },
  { code: 'daily_like_5', title: 'Поставить 5 лайков', event: 'LIKE_GIVEN', target: 5, coins: 25, xp: 10, icon: '❤️', href: '/' },
  { code: 'daily_game_3', title: 'Сыграть 3 раза', event: 'GAME_PLAYED', target: 3, coins: 45, xp: 20, icon: '🎮', href: '/games' },
  { code: 'daily_game_1', title: 'Сыграть в любую игру', event: 'GAME_PLAYED', target: 1, coins: 25, xp: 10, icon: '🕹️', href: '/games' },
  { code: 'daily_idea_vote_3', title: 'Поддержать 3 идеи', event: 'IDEA_VOTED', target: 3, coins: 35, xp: 15, icon: '💡', href: '/ideas' },
  { code: 'daily_idea', title: 'Предложить идею', event: 'IDEA_SUBMITTED', target: 1, coins: 80, xp: 40, icon: '✨', href: '/ideas/new' },
  { code: 'daily_follow', title: 'Подписаться на кого-нибудь', event: 'FOLLOW_MADE', target: 1, coins: 20, xp: 10, icon: '👥', href: '/search' },
  { code: 'daily_coins_200', title: 'Заработать 200 Z-коинов', event: 'COINS_EARNED', target: 200, coins: 50, xp: 15, icon: '🪙', href: '/games/z-clicker' },
];

export const QUESTS_PER_DAY = 3;

export function questByCode(code: string): QuestDefinition | undefined {
  return QUEST_POOL.find((q) => q.code === code);
}

/**
 * Deterministic per-user, per-day pick. Same inputs always give the same
 * three quests, so the set survives a page reload, a second device, and the
 * server restarting — without storing tomorrow's assignment anywhere.
 */
export function questsForDay(userId: string, dayIso: string): QuestDefinition[] {
  const pool = [...QUEST_POOL];
  const chosen: QuestDefinition[] = [];
  let seed = hash(`${userId}:${dayIso}`);

  for (let i = 0; i < QUESTS_PER_DAY && pool.length > 0; i += 1) {
    seed = nextSeed(seed);
    const index = seed % pool.length;
    chosen.push(pool.splice(index, 1)[0]);
  }
  // Stable display order regardless of draw order.
  return chosen.sort((a, b) => a.code.localeCompare(b.code));
}

/** FNV-1a: small, dependency-free, and good enough to scatter a handful of buckets. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Lehmer/park-miller step, so the three picks don't correlate with each other. */
function nextSeed(seed: number): number {
  return (Math.imul(seed, 48271) % 2147483647 >>> 0) || 1;
}
