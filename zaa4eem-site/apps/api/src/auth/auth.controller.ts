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
  changePasswordSchema,
  consumeTelegramLinkCodeSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  pendingReferralSchema,
  registerSchema,
  resetPasswordSchema,
  telegramAuthSchema,
  telegramWidgetAuthSchema,
  magicLinkRequestSchema,
  tokenOnlySchema,
  twoFactorSubmitSchema,
} from '@zaa4eem/shared';
import { WebAuthnService } from '../security/webauthn.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { BotAuthGuard } from './bot-auth.guard';
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

  constructor(
    private readonly auth: AuthService,
    private readonly webauthn: WebAuthnService,
  ) {}

  /** What we know about where a sign-in came from, for the sessions list and new-device alerts. */
  private context(req: Request) {
    return { userAgent: req.headers['user-agent'] ?? null, ip: req.ip ?? null };
  }

  /**
   * A login either completes (tokens + user) or stops at the 2FA step. The
   * refresh cookie is only ever set in the first case — a half-finished
   * login must not leave a usable session behind.
   */
  private respond(
    result: Awaited<ReturnType<AuthService['login']>>,
    res: Response,
  ) {
    if ('twoFactorRequired' in result) return result;
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken: result.accessToken, user: result.user };
  }

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

  @Post('google')
  async google(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = googleAuthSchema.parse(body);
    const { accessToken, refreshToken, user } = await this.auth.loginWithGoogle(input.credential);
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken, user };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = registerSchema.parse(body);
    const { accessToken, refreshToken, user } = await this.auth.register(input, this.context(req));
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken, user };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = loginSchema.parse(body);
    return this.respond(await this.auth.login(input, this.context(req)), res);
  }

  /** Second step of a 2FA login: the ticket from above, plus a code or a backup code. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa')
  @HttpCode(HttpStatus.OK)
  async twoFactor(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ticket, code } = twoFactorSubmitSchema.parse(body);
    return this.respond(await this.auth.submitSecondFactor(ticket, code, this.context(req)), res);
  }

  // ---- Email verification ----

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: unknown) {
    const { token } = tokenOnlySchema.parse(body);
    await this.auth.verifyEmail(token);
    return { verified: true };
  }

  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post('verify-email/resend')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async resendVerification(@CurrentUser() user: RequestUser) {
    await this.auth.resendVerification(user.id);
    return { sent: true };
  }

  // ---- Magic link ----

  /**
   * Answers identically whether or not the address is registered, so this
   * cannot be used to find out who has an account here.
   */
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  async magicLink(@Body() body: unknown) {
    const { email } = magicLinkRequestSchema.parse(body);
    await this.auth.requestMagicLink(email);
    return { sent: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('magic-link/consume')
  @HttpCode(HttpStatus.OK)
  async consumeMagicLink(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token } = tokenOnlySchema.parse(body);
    return this.respond(await this.auth.consumeMagicLink(token, this.context(req)), res);
  }

  // ---- Passkey login ----

  @Post('passkey/begin')
  @HttpCode(HttpStatus.OK)
  beginPasskeyLogin() {
    return this.webauthn.beginAuthentication();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('passkey/finish')
  @HttpCode(HttpStatus.OK)
  async finishPasskeyLogin(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.webauthn.finishAuthentication(body);
    return this.respond(await this.auth.issueSessionForUser(userId, this.context(req)), res);
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

  // One account everywhere, browser side: Settings shows this code, the
  // user sends it to the bot as /link <code>, which redeems it below.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('link/telegram/code')
  @UseGuards(JwtAuthGuard)
  async createTelegramLinkCode(@CurrentUser() user: RequestUser) {
    return this.auth.issueTelegramLinkCode(user.id);
  }

  // Called by apps/bot, never a browser — see BotAuthGuard. A 6-digit code
  // over a bot-facing endpoint is a brute-force surface, so this is rate
  // limited independently of (and much tighter than) the code-issuing one.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('link/telegram/consume')
  @UseGuards(BotAuthGuard)
  async consumeTelegramLinkCode(@Body() body: unknown) {
    const input = consumeTelegramLinkCodeSchema.parse(body);
    return this.auth.consumeTelegramLinkCode(input.code, BigInt(input.telegramId), input.telegramUsername);
  }

  // Called by apps/bot on /start ref_CODE, never a browser — see BotAuthGuard.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('referral/pending')
  @UseGuards(BotAuthGuard)
  async registerPendingReferral(@Body() body: unknown) {
    const input = pendingReferralSchema.parse(body);
    await this.auth.registerPendingReferral(input.code, BigInt(input.telegramId));
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

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() user: RequestUser, @Body() body: unknown, @Req() req: Request) {
    const { currentPassword, newPassword } = changePasswordSchema.parse(body);
    const raw = req.cookies?.[REFRESH_COOKIE];
    await this.auth.changePassword(user.id, currentPassword, newPassword, raw);
    return { message: 'Пароль обновлён. Остальные устройства вышли из аккаунта.' };
  }
}
