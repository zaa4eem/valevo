import { z } from 'zod';

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

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    role: z.enum(['OWNER', 'SUBSCRIBER']),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
