import type { ProgressEvent } from './levels';

/**
 * The five things a new account does that turn it into a returning one.
 *
 * Not a tutorial — every step is a real action with its own value, ordered
 * cheapest first so the checklist starts moving in the first minute. The
 * reward for finishing is 24 hours of Premium: a taste of the thing the
 * Shop sells, at the moment someone has just proven they'll come back.
 */
export interface OnboardingStep {
  code: string;
  title: string;
  hint: string;
  icon: string;
  event: ProgressEvent;
  target: number;
  href: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    code: 'onb_vote',
    title: 'Поддержать идею',
    hint: 'Один тап на доске идей',
    icon: '💡',
    event: 'IDEA_VOTED',
    target: 1,
    href: '/ideas',
  },
  {
    code: 'onb_game',
    title: 'Сыграть в игру',
    hint: 'Neon Snake или Z-Кликер',
    icon: '🎮',
    event: 'GAME_PLAYED',
    target: 1,
    href: '/games',
  },
  {
    code: 'onb_follow',
    title: 'Подписаться на кого-нибудь',
    hint: 'Лента станет своей',
    icon: '👥',
    event: 'FOLLOW_MADE',
    target: 1,
    href: '/search',
  },
  {
    code: 'onb_comment',
    title: 'Написать комментарий',
    hint: 'Ответить под любым постом',
    icon: '💬',
    event: 'COMMENT_WRITTEN',
    target: 1,
    href: '/',
  },
  {
    code: 'onb_post',
    title: 'Опубликовать пост',
    hint: 'Расскажите о себе',
    icon: '📝',
    event: 'POST_PUBLISHED',
    target: 1,
    href: '/',
  },
];

/** Hours of Premium handed out for completing all five. */
export const ONBOARDING_PREMIUM_HOURS = 24;

export function onboardingStepByCode(code: string): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find((s) => s.code === code);
}
