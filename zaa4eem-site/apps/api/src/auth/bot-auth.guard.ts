import { timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Gates endpoints only apps/bot may call (never a browser) — the bot proxies
 * a Telegram chat command into an API call it can't authenticate as a user
 * for (no JWT, no initData), so it authenticates as itself instead, using
 * the same TELEGRAM_BOT_TOKEN both processes already read from the shared
 * .env (see infra/docker-compose.yml) as a bearer secret.
 */
@Injectable()
export class BotAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers.authorization ?? '';
    const expected = `Bearer ${this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN')}`;

    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    const ok = providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
    if (!ok) {
      throw new UnauthorizedException('Недействительный служебный токен');
    }
    return true;
  }
}
