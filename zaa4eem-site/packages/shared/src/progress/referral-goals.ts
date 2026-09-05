/**
 * Referral goals. One invite already pays a 24h Premium trial (see
 * premium.util); these are the rungs above it, so the person who brought
 * three friends has a reason to bring a fourth.
 */
export interface ReferralGoal {
  code: string;
  invites: number;
  title: string;
  description: string;
  icon: string;
  coins: number;
  /** Days of Premium granted on top of the coins; 0 for none. */
  premiumDays: number;
}

export const REFERRAL_GOALS: ReferralGoal[] = [
  {
    code: 'ref_goal_3',
    invites: 3,
    title: 'Трое приглашённых',
    description: '3 человека пришли по вашей ссылке и завели аккаунт',
    icon: '🎊',
    coins: 500,
    premiumDays: 3,
  },
  {
    code: 'ref_goal_5',
    invites: 5,
    title: 'Пятеро приглашённых',
    description: '5 человек пришли по вашей ссылке',
    icon: '🎉',
    coins: 1500,
    premiumDays: 7,
  },
  {
    code: 'ref_goal_10',
    invites: 10,
    title: 'Десять приглашённых',
    description: '10 человек пришли по вашей ссылке',
    icon: '🚀',
    coins: 5000,
    premiumDays: 30,
  },
];

export function referralGoalByCode(code: string): ReferralGoal | undefined {
  return REFERRAL_GOALS.find((g) => g.code === code);
}
