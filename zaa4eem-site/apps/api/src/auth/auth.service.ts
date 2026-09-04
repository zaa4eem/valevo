import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { hashPassword, verifyPassword } from './password.util';
import {
  TelegramUserPayload,
  verifyTelegramInitData,
  verifyTelegramLoginWidget,
} from './telegram-verify';
import { GoogleAuthService, GoogleUserPayload } from './google-auth.service';
import { EmailService } from '../common/email.service';
import type { RegisterInput, LoginInput, TelegramAuthInput } from '@zaa4eem/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly google: GoogleAuthService,
  ) {}

  private botToken(): string {
    return this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
  }

  /** verifyTelegramInitData throws a plain Error — wrap it so the client sees
   * the real reason (expired, bad signature) as a 401 instead of a generic
   * 500 "Something went wrong" from the global exception filter. */
  private verifyInitDataOrThrow(initData: string): { user: TelegramUserPayload } {
    try {
      return verifyTelegramInitData(initData, this.botToken());
    } catch (err) {
      throw new UnauthorizedException(err instanceof Error ? err.message : 'Некорректные данные Telegram');
    }
  }

  async loginWithTelegram(input: TelegramAuthInput) {
    const { user: tgUser } = this.verifyInitDataOrThrow(input.initData);
    const user = await this.findOrCreateFromTelegram(tgUser);
    return this.issueSession(user.id, user.role);
  }

  /** Plain-browser login page path — classic Telegram Login Widget, not Mini App initData. */
  async loginWithTelegramWidget(data: Record<string, string | number>) {
    const ok = verifyTelegramLoginWidget(data, this.botToken());
    if (!ok) throw new UnauthorizedException('Не удалось подтвердить вход через Telegram');

    const tgUser: TelegramUserPayload = {
      id: Number(data.id),
      first_name: data.first_name as string | undefined,
      last_name: data.last_name as string | undefined,
      username: data.username as string | undefined,
      photo_url: data.photo_url as string | undefined,
    };
    const user = await this.findOrCreateFromTelegram(tgUser);
    return this.issueSession(user.id, user.role);
  }

  private async findOrCreateFromTelegram(tgUser: TelegramUserPayload) {
    const telegramId = BigInt(tgUser.id);
    let user = await this.users.findByTelegramId(telegramId);
    if (!user) {
      const displayName =
        [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
        tgUser.username ||
        'zaa4eem user';
      user = await this.users.createFromTelegram({
        telegramId,
        telegramUsername: tgUser.username,
        displayName,
        avatarUrl: tgUser.photo_url,
      });
      await this.users.attributeReferralFromPending(user.id, telegramId);
    }
    return user;
  }

  /** Registered by the bot on /start ref_CODE — see PendingReferral for why this can't wait for a real account to exist yet. */
  async registerPendingReferral(code: string, telegramId: bigint): Promise<void> {
    const referrer = await this.users.findByReferralCode(code);
    if (!referrer) return;
    // First-touch attribution only applies to brand-new signups — someone
    // who already has an account can't be "invited" retroactively.
    const alreadyLinked = await this.users.findByTelegramId(telegramId);
    if (alreadyLinked) return;
    await this.users.upsertPendingReferral(telegramId, referrer.id);
  }

  async loginWithGoogle(credential: string) {
    let payload: GoogleUserPayload;
    try {
      payload = await this.google.verifyIdToken(credential);
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Не удалось подтвердить вход через Google',
      );
    }
    const user = await this.findOrCreateFromGoogle(payload);
    return this.issueSession(user.id, user.role);
  }

  private async findOrCreateFromGoogle(payload: GoogleUserPayload) {
    const existingByGoogleId = await this.users.findByGoogleId(payload.googleId);
    if (existingByGoogleId) return existingByGoogleId;

    // Only trust the email for account-linking if Google itself verified it —
    // an unverified email is just a claim, not proof of ownership.
    if (payload.emailVerified && payload.email) {
      const existingByEmail = await this.users.findByEmail(payload.email);
      if (existingByEmail) {
        return this.users.linkGoogle(existingByEmail.id, payload.googleId);
      }
    }

    return this.users.createFromGoogle({
      googleId: payload.googleId,
      email: payload.emailVerified ? payload.email : undefined,
      displayName: payload.displayName || payload.email || 'zaa4eem user',
      avatarUrl: payload.avatarUrl,
    });
  }

  async linkTelegram(userId: string, input: TelegramAuthInput) {
    const { user: tgUser } = this.verifyInitDataOrThrow(input.initData);
    const telegramId = BigInt(tgUser.id);

    const existing = await this.users.findByTelegramId(telegramId);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Этот Telegram-аккаунт уже привязан к другому пользователю');
    }

    await this.users.linkTelegram(userId, telegramId, tgUser.username);
    return this.users.getPublicProfile(userId);
  }

  /** Settings → "Привязать Telegram" — one account everywhere, browser side. */
  async issueTelegramLinkCode(userId: string): Promise<{ code: string; expiresInMinutes: number }> {
    const code = await this.tokens.issueTelegramLinkCode(userId);
    return { code, expiresInMinutes: 10 };
  }

  /**
   * Redeemed by the bot on /link <code> — see BotAuthGuard for why this
   * doesn't need initData (a Telegram chat command has none) or a user JWT
   * (the bot isn't logged in as anyone; the code IS the credential).
   */
  async consumeTelegramLinkCode(code: string, telegramId: bigint, telegramUsername?: string) {
    const userId = await this.tokens.consumeTelegramLinkCode(code);
    if (!userId) {
      throw new UnauthorizedException('Код недействителен или истёк — сгенерируй новый в настройках');
    }

    const existing = await this.users.findByTelegramId(telegramId);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Этот Telegram-аккаунт уже привязан к другому пользователю');
    }

    await this.users.linkTelegram(userId, telegramId, telegramUsername);
    return this.users.getPublicProfile(userId);
  }

  async register(input: RegisterInput) {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictException('Аккаунт с такой почтой уже существует');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.users.createWithPassword({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    });

    if (input.referralCode) {
      const referrer = await this.users.findByReferralCode(input.referralCode);
      if (referrer) await this.users.attributeReferral(user.id, referrer);
    }

    return this.issueSession(user.id, user.role);
  }

  async login(input: LoginInput) {
    const user = await this.users.findByEmail(input.email);
    if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Неверная почта или пароль');
    }
    return this.issueSession(user.id, user.role);
  }

  async refresh(rawRefreshToken: string) {
    const rotated = await this.tokens.rotateRefreshToken(rawRefreshToken);
    if (!rotated) {
      throw new UnauthorizedException('Сессия истекла — войдите заново');
    }
    const user = await this.users.findById(rotated.userId);
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }
    return {
      accessToken: this.tokens.signAccessToken({ sub: user.id, role: user.role }),
      refreshToken: rotated.newRaw,
    };
  }

  async logout(rawRefreshToken: string) {
    await this.tokens.revokeRefreshToken(rawRefreshToken);
  }

  /**
   * Always resolves the same way whether or not the email is registered —
   * the controller returns one generic message either way so this endpoint
   * can't be used to check which emails have accounts.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash) return;

    const raw = await this.tokens.issuePasswordResetToken(user.id);
    const siteUrl = this.config.get<string>('MINI_APP_URL', 'http://localhost:3000');
    const resetUrl = `${siteUrl.replace(/\/$/, '')}/reset-password?token=${raw}`;
    await this.email.sendPasswordReset(email, resetUrl);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.tokens.consumePasswordResetToken(token);
    if (!userId) {
      throw new UnauthorizedException('Ссылка для сброса пароля недействительна или устарела');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.users.setPassword(userId, passwordHash);
    // Reset means "I might have lost control of this account" — sign every
    // session out rather than leaving old refresh tokens valid.
    await this.tokens.revokeAllForUser(userId);
  }

  private async issueSession(userId: string, role: string) {
    const [accessToken, refreshToken, profile] = await Promise.all([
      this.tokens.signAccessToken({ sub: userId, role }),
      this.tokens.issueRefreshToken(userId),
      this.users.getPublicProfile(userId),
    ]);
    return { accessToken, refreshToken, user: profile };
  }
}
