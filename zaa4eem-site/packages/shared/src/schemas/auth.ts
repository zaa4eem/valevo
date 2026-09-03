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

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов'),
  displayName: z.string().min(2).max(60),
});
export type RegisterInput = z.infer<typeof registerSchema>;

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
    })
    .merge(premiumFieldsSchema),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
