import { randomBytes, randomInt, createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  role: string;
}

const REFRESH_TOKEN_TTL_DAYS = 30;
const ACCESS_TOKEN_TTL = '15m';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /** Issues a new refresh token, stores only its hash, returns the raw value. */
  async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const tokenHash = this.hashRefreshToken(raw);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return raw;
  }

  /**
   * Rotates a refresh token: revokes it and issues a fresh one. The revoke
   * is an atomic compare-and-swap (updateMany guarded on revokedAt: null,
   * checked via the result count) rather than a plain read-then-write —
   * two near-simultaneous calls with the same raw token could otherwise
   * both pass a `findFirst` check before either commits, each minting its
   * own valid replacement from the one original (session forking).
   *
   * Reusing an already-rotated token (count === 0 but the hash exists,
   * just revoked) is the textbook signature of a stolen refresh token —
   * the legitimate owner already has a newer one, so whoever presents the
   * old one next is either that owner using a stale copy or an attacker
   * replaying a captured one. Either way, revoke every session for that
   * user: the genuine owner just needs to log in again, which is a much
   * smaller cost than leaving a stolen token's lineage alive.
   */
  async rotateRefreshToken(raw: string): Promise<{ userId: string; newRaw: string } | null> {
    const tokenHash = this.hashRefreshToken(raw);
    const result = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      const replayed = await this.prisma.refreshToken.findFirst({
        where: { tokenHash, revokedAt: { not: null } },
      });
      if (replayed) {
        await this.revokeAllForUser(replayed.userId);
      }
      return null;
    }

    const record = await this.prisma.refreshToken.findFirstOrThrow({ where: { tokenHash } });
    const newRaw = await this.issueRefreshToken(record.userId);
    return { userId: record.userId, newRaw };
  }

  async revokeRefreshToken(raw: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(raw);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * exceptRawToken lets a logged-in change-password flow keep the *current*
   * browser session alive while still nuking every other one — unlike
   * resetPassword (an unauthenticated flow with no "current session" to
   * preserve), changePassword is called from an active session whose
   * refresh cookie rides along on the same request.
   */
  async revokeAllForUser(userId: string, exceptRawToken?: string): Promise<void> {
    const exceptHash = exceptRawToken ? this.hashRefreshToken(exceptRawToken) : undefined;
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(exceptHash ? { tokenHash: { not: exceptHash } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Issues a password reset token, stores only its hash, returns the raw value. */
  async issuePasswordResetToken(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    const tokenHash = this.hashRefreshToken(raw);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return raw;
  }

  /** Marks a reset token used and returns its owner's id, or null if it's unknown, expired, or already used. */
  async consumePasswordResetToken(raw: string): Promise<string | null> {
    const tokenHash = this.hashRefreshToken(raw);
    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record) return null;

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record.userId;
  }

  /**
   * Issues a 6-digit code a logged-in browser session shows in Settings, to
   * be redeemed from a Telegram chat (/link <code> — see AuthService.
   * consumeTelegramLinkCode) where there's no initData to verify a Mini App
   * session with. Any earlier unused code for this user is invalidated
   * first, so only the most recently generated one ever works.
   */
  async issueTelegramLinkCode(userId: string): Promise<string> {
    await this.prisma.telegramLinkCode.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    // randomInt (CSPRNG), not Math.random — this code is a bearer credential,
    // even if a short-lived, single-use, 6-digit one.
    const raw = String(randomInt(100000, 1000000));
    const codeHash = this.hashRefreshToken(raw);
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);

    await this.prisma.telegramLinkCode.create({
      data: { userId, codeHash, expiresAt },
    });

    return raw;
  }

  /** Marks a link code used and returns its owner's id, or null if it's unknown, expired, or already used. */
  async consumeTelegramLinkCode(raw: string): Promise<string | null> {
    const codeHash = this.hashRefreshToken(raw);
    const record = await this.prisma.telegramLinkCode.findFirst({
      where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record) return null;

    await this.prisma.telegramLinkCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record.userId;
  }

  private hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
