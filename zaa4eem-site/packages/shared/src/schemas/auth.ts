import { z } from 'zod';
import { premiumFieldsSchema } from './users';

export const telegramAuthSchema = z.object({
  initData: z.string().min(1, 'Отсутствуют данные авторизации Telegram'),
});
export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;

/** Payload shape from the classic Telegram Login Widget (website login page). */
export const telegramWidgetAuthSchema = z.object({
  id: z.union([z.string(), z.number()]),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.union([z.string(), z.number()]),
  hash: z.string(),
});
export type TelegramWidgetAuthInput = z.infer<typeof telegramWidgetAuthSchema>;

/** The signed ID token JWT handed back by Google Identity Services — verified server-side, never trusted as-is. */
export const googleAuthSchema = z.object({
  credential: z.string().min(1, 'Отсутствуют данные авторизации Google'),
});
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов'),
  displayName: z.string().min(2).max(60),
  // From /r/CODE — attributed only at this first registration, never retroactively.
  referralCode: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Sent by the bot on /start ref_CODE — before the inviting Telegram identity has an account yet, so this can't go through the normal registerSchema flow. */
export const pendingReferralSchema = z.object({
  code: z.string().min(1),
  telegramId: z.union([z.string(), z.number()]),
});
export type PendingReferralInput = z.infer<typeof pendingReferralSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Отсутствует токен сброса пароля'),
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const telegramLinkCodeResponseSchema = z.object({
  code: z.string(),
  expiresInMinutes: z.number().int().positive(),
});
export type TelegramLinkCodeResponse = z.infer<typeof telegramLinkCodeResponseSchema>;

/** Sent by the bot (never a browser) — see BotAuthGuard, not a user-facing form. */
export const consumeTelegramLinkCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Код должен состоять из 6 цифр'),
  telegramId: z.union([z.string(), z.number()]),
  telegramUsername: z.string().optional(),
});
export type ConsumeTelegramLinkCodeInput = z.infer<typeof consumeTelegramLinkCodeSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  // The actual endpoints (register/login/refresh, and GET /users/me which
  // shares the same shape) all return the full PublicProfile-shaped user via
  // UsersService.getPublicProfile — merging premiumFieldsSchema here just
  // makes that already-present data visible to the type, so callers like
  // Navbar can render PremiumName/PremiumAvatar for the signed-in user.
  user: z
    .object({
      id: z.string().uuid(),
      role: z.enum(['OWNER', 'SUBSCRIBER']),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      referralCode: z.string(),
      usedTrialPremium: z.boolean(),
    })
    .merge(premiumFieldsSchema),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
