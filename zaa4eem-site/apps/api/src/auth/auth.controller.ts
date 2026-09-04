import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  telegramAuthSchema,
  telegramWidgetAuthSchema,
} from '@zaa4eem/shared';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, RequestUser } from './current-user.decorator';

const REFRESH_COOKIE = 'zaa4eem_refresh';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly auth: AuthService) {}

  @Post('telegram')
  async telegram(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = telegramAuthSchema.parse(body);
    const { accessToken, refreshToken, user } = await this.auth.loginWithTelegram(input);
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken, user };
  }

  @Post('telegram/widget')
  async telegramWidget(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = telegramWidgetAuthSchema.parse(body);
    const { accessToken, refreshToken, user } = await this.auth.loginWithTelegramWidget(input);
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken, user };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = registerSchema.parse(body);
    const { accessToken, refreshToken, user } = await this.auth.register(input);
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken, user };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = loginSchema.parse(body);
    const { accessToken, refreshToken, user } = await this.auth.login(input);
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken, user };
  }

  // Temporary diagnostic logging (owner report: browser tab refresh logs
  // people out on the live deploy but not reproducible against localhost —
  // almost certainly the cross-subdomain cookie, but there's no way to see
  // *why* it's failing without eyes on the actual request) — remove once
  // the real cause is confirmed and fixed.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    const origin = req.headers.origin ?? 'none';
    const cookieHeaderPresent = Boolean(req.headers.cookie);
    if (!raw) {
      this.logger.warn(
        `refresh: no ${REFRESH_COOKIE} cookie (Origin=${origin}, Cookie header present=${cookieHeaderPresent}, all cookie names=${Object.keys(req.cookies ?? {}).join(',') || 'none'})`,
      );
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }
    try {
      const { accessToken, refreshToken } = await this.auth.refresh(raw);
      res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
      return { accessToken };
    } catch (err) {
      this.logger.warn(`refresh: rejected (Origin=${origin}) — ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204);
  }

  @Post('link/telegram')
  @UseGuards(JwtAuthGuard)
  async linkTelegram(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const input = telegramAuthSchema.parse(body);
    return this.auth.linkTelegram(user.id, input);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() body: unknown) {
    const { email } = forgotPasswordSchema.parse(body);
    await this.auth.forgotPassword(email);
    return {
      message: 'Если аккаунт с такой почтой существует, мы отправили на неё ссылку для сброса пароля.',
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() body: unknown) {
    const { token, password } = resetPasswordSchema.parse(body);
    await this.auth.resetPassword(token, password);
    return { message: 'Пароль обновлён — теперь можно войти с новым паролем.' };
  }
}
