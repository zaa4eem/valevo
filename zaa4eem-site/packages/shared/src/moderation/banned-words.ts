// Curated banned-word/pattern list for the automated content filter
// (research.md §3). This is a starting-point list, not exhaustive —
// the owner extends it over time via ADMIN_EXTRA_BANNED_WORDS (see
// moderation.service.ts). Kept deliberately short here; real deployments
// should treat this as a seed, not the final word.

export const BANNED_SUBSTRINGS_RU: string[] = [
  'хуй',
  'хуе',
  'хуё',
  'пизд',
  'ебат',
  'ёбан',
  'еба',
  'бляд',
  'блять',
  'сука бл',
  'мудак',
  'долбоеб',
  'долбоёб',
  'пидор',
  'пидар',
  'залупа',
];

export const BANNED_SUBSTRINGS_EN: string[] = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'nigger',
  'faggot',
];

// Patterns tied to categories that are outright illegal to distribute under
// RF law rather than merely rude — kept separate so these can be treated
// with zero tolerance if ever needed.
export const RESTRICTED_TOPIC_PATTERNS: RegExp[] = [
  /\bкупить\s+(оружие|наркот\w*)\b/i,
  /\bбуду\w*\s+казино\b/i,
];

export function allBannedSubstrings(extra: string[] = []): string[] {
  return [...BANNED_SUBSTRINGS_RU, ...BANNED_SUBSTRINGS_EN, ...extra].map((w) =>
    w.toLowerCase(),
  );
}
