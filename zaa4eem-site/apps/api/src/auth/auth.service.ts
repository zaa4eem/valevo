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
import type { RegisterInput, LoginInput, TelegramAuthInput } from '@zaa4eem/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  private botToken(): string {
    return this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
  }

  async loginWithTelegram(input: TelegramAuthInput) {
    const { user: tgUser } = verifyTelegramInitData(input.initData, this.botToken());
    const user = await this.findOrCreateFromTelegram(tgUser);
    return this.issueSession(user.id, user.role);
  }

  /** Plain-browser login page path — classic Telegram Login Widget, not Mini App initData. */
  async loginWithTelegramWidget(data: Record<string, string | number>) {
    const ok = verifyTelegramLoginWidget(data, this.botToken());
    if (!ok) throw new UnauthorizedException('Invalid Telegram login payload');

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
    }
    return user;
  }

  async linkTelegram(userId: string, input: TelegramAuthInput) {
    const { user: tgUser } = verifyTelegramInitData(input.initData, this.botToken());
    const telegramId = BigInt(tgUser.id);

    const existing = await this.users.findByTelegramId(telegramId);
    if (existing && existing.id !== userId) {
      throw new ConflictException('This Telegram account is already linked to another user');
    }

    await this.users.linkTelegram(userId, telegramId, tgUser.username);
    return this.users.getPublicProfile(userId);
  }

  async register(input: RegisterInput) {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.users.createWithPassword({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    });

    return this.issueSession(user.id, user.role);
  }

  async login(input: LoginInput) {
    const user = await this.users.findByEmail(input.email);
    if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueSession(user.id, user.role);
  }

  async refresh(rawRefreshToken: string) {
    const rotated = await this.tokens.rotateRefreshToken(rawRefreshToken);
    if (!rotated) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    const user = await this.users.findById(rotated.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      accessToken: this.tokens.signAccessToken({ sub: user.id, role: user.role }),
      refreshToken: rotated.newRaw,
    };
  }

  async logout(rawRefreshToken: string) {
    await this.tokens.revokeRefreshToken(rawRefreshToken);
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
