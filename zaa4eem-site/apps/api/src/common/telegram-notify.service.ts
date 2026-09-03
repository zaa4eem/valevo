import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Fire-and-forget DMs to users via the Telegram Bot API, independent of the
 * apps/bot grammy process — the API already holds TELEGRAM_BOT_TOKEN for
 * initData verification, so it can call sendMessage directly rather than
 * coordinating with a second running service. A user with no linked
 * Telegram account (telegramId null) is silently skipped, and any failure
 * (blocked the bot, network blip) is logged and swallowed — a notification
 * must never fail the action that triggered it (liking a post, voting).
 */
@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);
  private readonly token?: string;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
  }

  async notify(telegramId: bigint | null | undefined, text: string): Promise<void> {
    if (!telegramId || !this.token) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId.toString(), text }),
      });
      if (!res.ok) {
        this.logger.warn(`sendMessage to ${telegramId} failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.logger.warn(`sendMessage to ${telegramId} threw: ${err instanceof Error ? err.message : err}`);
    }
  }
}
