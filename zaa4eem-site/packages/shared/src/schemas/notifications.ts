import { z } from 'zod';

export const notificationTypeValues = [
  'POST_LIKED',
  'POST_COMMENTED',
  'NEW_FOLLOWER',
  'IDEA_STATUS_CHANGED',
  'IDEA_VOTED',
  'RECORD_BEATEN',
  'PREMIUM_GRANTED',
  'SYSTEM',
] as const;
export type NotificationType = (typeof notificationTypeValues)[number];

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(notificationTypeValues),
  /** Pre-rendered Russian text, decided when the event happened. */
  body: z.string(),
  /** Who caused it — null for system messages. */
  actor: z
    .object({
      id: z.string().uuid(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
  /** Where tapping it should go, already resolved to a path by the backend. */
  href: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const paginatedNotificationsSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().uuid().nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type PaginatedNotifications = z.infer<typeof paginatedNotificationsSchema>;

export const notificationsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Coarse grouping used by the filter chips on the notifications screen. */
  filter: z.enum(['all', 'games', 'ideas', 'social']).default('all'),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const unreadCountSchema = z.object({ unreadCount: z.number().int().nonnegative() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/** Per-user switches. The in-app bell is always on — only the interrupting channels are opt-out. */
export const notificationPrefsSchema = z.object({
  notifyLikes: z.boolean(),
  notifyComments: z.boolean(),
  notifyFollows: z.boolean(),
  notifyIdeas: z.boolean(),
  notifyRecords: z.boolean(),
  notifyPush: z.boolean(),
  notifyTelegram: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const updateNotificationPrefsSchema = notificationPrefsSchema.partial();
export type UpdateNotificationPrefsInput = z.infer<typeof updateNotificationPrefsSchema>;

/** The browser's PushSubscription, as handed over by pushManager.subscribe(). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushPublicKeySchema = z.object({
  /** null when the deployment has no VAPID keys configured — the UI then hides the push toggle instead of offering something that can't work. */
  publicKey: z.string().nullable(),
});
export type PushPublicKey = z.infer<typeof pushPublicKeySchema>;
