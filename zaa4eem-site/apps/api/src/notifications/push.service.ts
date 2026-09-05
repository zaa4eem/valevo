import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import type { PushSubscriptionInput } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Web Push delivery. Reaches a phone or desktop even with the site closed,
 * which is the one thing the existing Telegram DMs could never do for the
 * majority of users who never linked a Telegram account.
 *
 * Entirely optional at runtime: with no VAPID keys configured the service
 * reports itself unavailable, the frontend hides the toggle, and everything
 * else (the in-app bell, Telegram DMs) carries on unaffected. That keeps a
 * deployment that hasn't generated keys yet from failing at boot.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private publicKey: string | null = null;
  private configured = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT', 'mailto:owner@zaa4eem.ru');

    if (!publicKey || !privateKey) {
      this.logger.log('VAPID keys not set — web push disabled (everything else works as normal)');
      return;
    }

    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.publicKey = publicKey;
      this.configured = true;
      this.logger.log('Web push enabled');
    } catch (err) {
      this.logger.warn(`VAPID configuration rejected, web push stays off: ${err instanceof Error ? err.message : err}`);
    }
  }

  isConfigured() {
    return this.configured;
  }

  getPublicKey() {
    return this.publicKey;
  }

  async subscribe(userId: string, input: PushSubscriptionInput, userAgent?: string) {
    // The endpoint is the browser's own identity for this subscription, so
    // re-subscribing on a device it already registered updates that row
    // rather than piling up duplicates that would each get their own copy
    // of every notification.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent,
      },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent,
      },
    });
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /**
   * Fire-and-forget by design: a notification must never fail the action
   * that caused it. Subscriptions the push service rejects as gone (404/410)
   * are deleted, which is the documented way to keep the table from filling
   * up with browsers that were uninstalled or cleared.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
            return;
          }
          this.logger.warn(
            `push to ${sub.endpoint.slice(0, 48)}… failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }),
    );
  }
}
