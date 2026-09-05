import { z } from 'zod';

export const premiumNameStyleValues = ['FLOW', 'HOLO', 'GLOW'] as const;
export const premiumRingStyleValues = ['SPIN', 'PULSE', 'GLOW', 'RAINBOW', 'VENOM'] as const;
/** Curated set — not arbitrary font upload — so the CSS bundle stays bounded. */
export const premiumNameFontValues = ['SPACE', 'SERIF', 'PIXEL'] as const;
/** Fixed emoji set the owner picks from when granting Premium — not free text. */
export const premiumBadgeEmojiValues = ['👑', '💎', '🔥', '⭐', '✨', '🚀'] as const;

/** Cosmetic-only fields, owner-granted — merged into any schema that renders a name/avatar. */
export const premiumFieldsSchema = z.object({
  isPremium: z.boolean(),
  nameStyle: z.enum(premiumNameStyleValues).nullable(),
  nameColor: z.string().nullable(),
  ringStyle: z.enum(premiumRingStyleValues).nullable(),
  nameFont: z.enum(premiumNameFontValues).nullable(),
  badgeEmoji: z.string().nullable(),
  // null while isPremium is true means granted forever (owner "Навсегда", or
  // an old grant from before Premium had a term) — a date means it lazily
  // expires the next time PremiumUtil.ensurePremiumFresh sees this row.
  premiumUntil: z.string().nullable(),
});
export type PremiumFields = z.infer<typeof premiumFieldsSchema>;

// Self-service: a user the owner already granted Premium to picks their own
// look from the same fixed option set the owner uses (POST /admin/.../premium).
// Deliberately excludes isPremium — granting/revoking Premium itself stays
// owner-only.
export const updatePremiumStyleSchema = z.object({
  nameStyle: z.enum(premiumNameStyleValues).nullable(),
  nameColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Цвет должен быть в формате #RRGGBB')
    .nullable(),
  ringStyle: z.enum(premiumRingStyleValues).nullable(),
  nameFont: z.enum(premiumNameFontValues).nullable(),
  badgeEmoji: z.enum(premiumBadgeEmojiValues).nullable(),
});
export type UpdatePremiumStyleInput = z.infer<typeof updatePremiumStyleSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(60).optional(),
  // Restricted to http(s): z.string().url() alone accepts any URL scheme
  // (javascript:, data:, ...), and nothing else here re-checks that this
  // was actually a URL POST /users/me/avatar issued.
  avatarUrl: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), 'URL должен начинаться с http:// или https://')
    .nullable()
    .optional(),
  bio: z.string().max(500).nullable().optional(),
  statusText: z.string().max(80).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** online: heartbeat within 5 min · away: 5–30 min ago · offline: >30 min ago or never. */
export const presenceValues = ['ONLINE', 'AWAY', 'OFFLINE'] as const;
export type Presence = (typeof presenceValues)[number];

export const topGameBadgeSchema = z.object({ gameSlug: z.string(), gameTitle: z.string() });
export type TopGameBadge = z.infer<typeof topGameBadgeSchema>;

/**
 * Sent alongside a GIF avatar upload (multipart form fields, hence
 * z.coerce) so the backend can crop+resize it with gifsicle — frame by
 * frame, unlike a <canvas> draw which would only capture one frame and
 * kill the animation. Pixel coordinates in the ORIGINAL uploaded image.
 */
export const avatarGifCropSchema = z.object({
  cropX: z.coerce.number().min(0),
  cropY: z.coerce.number().min(0),
  cropSize: z.coerce.number().positive(),
});
export type AvatarGifCropInput = z.infer<typeof avatarGifCropSchema>;

export const publicProfileSchema = z
  .object({
    id: z.string().uuid(),
    memberNumber: z.number().int().positive(),
    role: z.enum(['OWNER', 'SUBSCRIBER']),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    bannerUrl: z.string().nullable(),
    bio: z.string().nullable(),
    statusText: z.string().nullable(),
    hasTelegram: z.boolean(),
    telegramUsername: z.string().nullable(),
    // Whether an email/password login is set — never the hash itself. Lets
    // Settings' "Безопасность" section know if it should ask for the
    // *current* password before accepting a new one (Telegram/Google-only
    // accounts have none to check yet).
    hasPassword: z.boolean(),
    createdAt: z.string(),
    followerCount: z.number().int().nonnegative(),
    followingCount: z.number().int().nonnegative(),
    viewerIsFollowing: z.boolean().optional(),
    presence: z.enum(presenceValues),
    // 1..999, derived from stats.ideasAcceptedCount (capped) — null if they've
    // never had an idea accepted, so no badge renders at all.
    ideaAuthorLevel: z.number().int().min(1).max(999).nullable(),
    // Current #1 on a game's leaderboard, recomputed fresh on every profile
    // fetch — never stored, so it moves the instant someone else takes the spot.
    topGameBadges: z.array(topGameBadgeSchema),
    // Public by design — an invite code is meant to be shared, not a secret.
    referralCode: z.string(),
    usedTrialPremium: z.boolean(),
    ideaCredits: z.array(
      z.object({ id: z.string().uuid(), description: z.string(), createdAt: z.string() }),
    ),
    stats: z.object({
      ideasSubmittedCount: z.number().int().nonnegative(),
      ideasAcceptedCount: z.number().int().nonnegative(),
      gamesPlayedCount: z.number().int().nonnegative(),
      bestScoresByGame: z.array(
        z.object({ gameSlug: z.string(), gameTitle: z.string(), value: z.number().int() }),
      ),
    }),
  })
  .merge(premiumFieldsSchema);
export type PublicProfile = z.infer<typeof publicProfileSchema>;

export const userSummarySchema = z
  .object({
    id: z.string().uuid(),
    memberNumber: z.number().int().positive(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    role: z.enum(['OWNER', 'SUBSCRIBER']),
  })
  .merge(premiumFieldsSchema);
export type UserSummary = z.infer<typeof userSummarySchema>;

export const paginatedUserSummariesSchema = z.object({
  items: z.array(userSummarySchema),
  nextCursor: z.string().uuid().nullable(),
});
export type PaginatedUserSummaries = z.infer<typeof paginatedUserSummariesSchema>;

export const userListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** "#0001" style member tag. Range is a display convention (4 digits), not a hard cap — the sequence keeps counting past 9999. */
export function formatMemberNumber(memberNumber: number): string {
  return `#${String(memberNumber).padStart(4, '0')}`;
}
