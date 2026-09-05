/**
 * Password strength, scored the same way on both sides.
 *
 * Deliberately not a character-class checklist ("needs a capital and a
 * digit"): those rules reliably produce Password1! and nothing better. What
 * actually predicts a survivable password is length and unpredictability,
 * so length dominates the score and the penalties target the shapes people
 * reach for when a checklist is shouting at them.
 */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordVerdict = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordAssessment {
  /** 0-4, for the meter's segments. */
  score: number;
  verdict: PasswordVerdict;
  label: string;
  /** The single most useful next step, or null when there is nothing to add. */
  advice: string | null;
}

/** Patterns that make a long password no better than a short one. */
const COMMON = [
  'password',
  'пароль',
  'qwerty',
  'йцукен',
  '123456',
  'admin',
  'zaa4eem',
  'letmein',
  'welcome',
  'iloveyou',
];

const VERDICT_LABELS: Record<PasswordVerdict, string> = {
  weak: 'Слабый',
  fair: 'Так себе',
  good: 'Хороший',
  strong: 'Надёжный',
};

export function assessPassword(password: string): PasswordAssessment {
  const value = password ?? '';
  if (value.length === 0) {
    return { score: 0, verdict: 'weak', label: VERDICT_LABELS.weak, advice: null };
  }

  let score = 0;
  // Length is the whole ballgame.
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;

  // The last point goes to *either* real length or real variety, so a
  // four-word passphrase can reach the top on length alone. Requiring the
  // variety for it would mean "correct horse battery staple" — the textbook
  // strong password — scores below "P@ssw0rd1", which is exactly the
  // checklist thinking this scorer exists to avoid.
  const classes = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\dA-Za-zА-Яа-яЁё]/].filter((re) =>
    re.test(value),
  ).length;
  if (value.length >= 20 || classes >= 3) score += 1;

  const lower = value.toLowerCase();
  if (COMMON.some((word) => lower.includes(word))) score = Math.min(score, 1);
  // "aaaaaaaaaaaa" and "abcabcabcabc" are long and worthless.
  if (/^(.)\1+$/.test(value)) score = 0;
  else if (/^(.{1,3})\1+$/.test(value)) score = Math.min(score, 1);
  if (value.length < PASSWORD_MIN_LENGTH) score = 0;

  score = Math.max(0, Math.min(4, score));
  const verdict: PasswordVerdict =
    score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';

  return {
    score,
    verdict,
    label: VERDICT_LABELS[verdict],
    advice: adviceFor(value, score),
  };
}

function adviceFor(value: string, score: number): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) return `Минимум ${PASSWORD_MIN_LENGTH} символов`;
  if (score >= 4) return null;
  if (value.length < 12) return 'Длина решает больше всего — попробуйте фразу из трёх слов';
  const lower = value.toLowerCase();
  if (COMMON.some((word) => lower.includes(word))) return 'Уберите распространённое слово';
  return 'Добавьте ещё слово или несколько символов';
}
