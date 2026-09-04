import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from '../common/telegram-notify.service';

export const DIGEST_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A private 3-day activity summary DM'd straight to the owner's own Telegram
 * account (DIGEST_CHAT_ID) — not a public channel. Skips sending entirely
 * when there was no activity in the window, so it never spams an empty
 * message every 3 days regardless.
 */
@Injectable()
export class DigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestService.name);
  private readonly chatId?: string;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramNotifyService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('DIGEST_CHAT_ID');
  }

  onModuleInit() {
    // Tests drive sendDigest() directly — a live interval would keep the
    // Jest process alive past the test run and race against fake timers.
    if (!this.chatId || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.sendDigest().catch((err) => {
        this.logger.warn(`Digest send failed: ${err instanceof Error ? err.message : err}`);
      });
    }, DIGEST_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Builds and sends the digest now — also used by the manual admin trigger and tests. Returns the sent text, or null if skipped (no chat configured, or nothing happened in the window). */
  async sendDigest(): Promise<string | null> {
    if (!this.chatId) return null;
    const since = new Date(Date.now() - DIGEST_INTERVAL_MS);
    const lines: string[] = [];

    const topIdea = await this.prisma.idea.findFirst({
      where: { createdAt: { gte: since } },
      orderBy: [{ voteCount: 'desc' }, { createdAt: 'desc' }],
    });
    if (topIdea) {
      lines.push(`💡 Топ-идея за 3 дня: «${topIdea.title}» — ${topIdea.voteCount} голосов`);
    }

    const topScores = await this.prisma.score.findMany({
      where: { createdAt: { gte: since }, reviewState: 'NORMAL' },
      orderBy: { value: 'desc' },
      take: 3,
      include: { user: true, game: true },
    });
    for (const score of topScores) {
      lines.push(`🔥 ${score.user.displayName} — ${score.value} очков в «${score.game.title}»`);
    }

    const premiumEvents = await this.prisma.moderationLogEntry.findMany({
      where: {
        targetType: 'USER',
        action: { in: ['premium:granted', 'premium:purchased'] },
        createdAt: { gte: since },
      },
    });
    if (premiumEvents.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: premiumEvents.map((e) => e.targetId) } },
      });
      const nameById = new Map(users.map((u) => [u.id, u.displayName]));
      for (const event of premiumEvents) {
        lines.push(`👑 ${nameById.get(event.targetId) ?? 'Пользователь'} получил Premium`);
      }
    }

    if (lines.length === 0) return null;

    const text = `Сводка ZAA4EEM за 3 дня:\n\n${lines.join('\n')}`;
    await this.telegram.notify(BigInt(this.chatId), text);
    return text;
  }
}
