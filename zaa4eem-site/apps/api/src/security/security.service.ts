import { createHash, randomInt } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assessPassword, type SecurityOverview, type SessionInfo } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { BreachCheckService } from './breach-check.service';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.util';
import { describeDevice } from './device.util';
import { hashPassword, verifyPassword } from '../auth/password.util';

const BACKUP_CODE_COUNT = 10;

/** Hashing anything single-use we hand out: same one-way treatment as a refresh token. */
export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly breach: BreachCheckService,
    private readonly config: ConfigService,
  ) {}

  // ---- Overview ----

  async overview(userId: string, currentSessionId?: string): Promise<SecurityOverview> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [passkeys, sessions, backupCodesLeft] = await Promise.all([
      this.prisma.webAuthnCredential.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.listSessions(userId, currentSessionId),
      this.prisma.backupCode.count({ where: { userId, usedAt: null } }),
    ]);

    return {
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      hasPassword: user.passwordHash !== null,
      totpEnabled: user.totpEnabledAt !== null,
      backupCodesLeft,
      passkeys: passkeys.map((p) => ({
        id: p.id,
        label: p.label,
        createdAt: p.createdAt.toISOString(),
        lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      })),
      sessions,
      emailAvailable: this.email.isConfigured(),
    };
  }

  // ---- Sessions ----

  /**
   * `currentSessionId` comes from the access token's `sid` claim, not from
   * the refresh cookie — that cookie is scoped to /api/auth and never
   * reaches this controller, which is exactly why the claim exists.
   */
  async listSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

    return rows.map((row) => ({
      id: row.id,
      label: row.deviceLabel ?? describeDevice(row.userAgent),
      network: row.ipPrefix,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      current: currentSessionId !== undefined && row.id === currentSessionId,
    }));
  }

  /** Revokes one session by its row id, scoped to the caller so an id guess reaches nothing. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Сеанс не найден');
  }

  /** "Выйти на всех устройствах" — everything except the session asking. */
  async revokeOtherSessions(userId: string, currentSessionId?: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  // ---- Password checking ----

  async checkPassword(password: string) {
    const assessment = assessPassword(password);
    return { ...assessment, breachCount: await this.breach.countBreaches(password) };
  }

  // ---- TOTP ----

  /**
   * Starts enrolment. The secret is stored immediately but stays inert:
   * nothing checks it until totpEnabledAt is set, which only confirmTotp
   * does, and only after the user reads a real code off it.
   */
  async beginTotp(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new BadRequestException('Двухфакторная защита уже включена');

    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    return { secret, uri: totpUri(secret, user.email ?? user.displayName) };
  }

  async confirmTotp(userId: string, code: string): Promise<string[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new BadRequestException('Двухфакторная защита уже включена');
    if (!user.totpSecret) throw new BadRequestException('Сначала начните настройку');
    if (!verifyTotp(user.totpSecret, code)) throw new BadRequestException('Код неверный');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
    // Enabling 2FA without recovery codes is how people lose accounts to a
    // lost phone, so they are issued in the same step, not offered later.
    return this.regenerateBackupCodes(userId);
  }

  /** Turning 2FA off needs the current password, so a borrowed unlocked session can't do it. */
  async disableTotp(userId: string, password?: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt) throw new BadRequestException('Двухфакторная защита не включена');

    if (user.passwordHash) {
      if (!password || !(await verifyPassword(password, user.passwordHash))) {
        throw new BadRequestException('Неверный пароль');
      }
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpEnabledAt: null },
      }),
      this.prisma.backupCode.deleteMany({ where: { userId } }),
    ]);
  }

  /** Replaces the whole set — old codes stop working the moment new ones are shown. */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => formatBackupCode());
    await this.prisma.$transaction([
      this.prisma.backupCode.deleteMany({ where: { userId } }),
      this.prisma.backupCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashSecret(normalizeBackupCode(code)) })),
      }),
    ]);
    return codes;
  }

  /**
   * Checks a 2FA answer: either a live TOTP code, or one backup code, which
   * is consumed. Returns false rather than throwing so the caller decides
   * what a failure costs.
   */
  async verifySecondFactor(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabledAt) return false;

    if (verifyTotp(user.totpSecret, code)) return true;

    const hash = hashSecret(normalizeBackupCode(code));
    // Consumed with a guarded update, not a read-then-write: two parallel
    // submissions of the same code must not both succeed.
    const consumed = await this.prisma.backupCode.updateMany({
      where: { userId, codeHash: hash, usedAt: null },
      data: { usedAt: new Date() },
    });
    return consumed.count > 0;
  }

  // ---- Passkey management (registration/authentication live in WebAuthnService) ----

  async renamePasskey(userId: string, id: string, label: string): Promise<void> {
    const result = await this.prisma.webAuthnCredential.updateMany({
      where: { id, userId },
      data: { label },
    });
    if (result.count === 0) throw new NotFoundException('Ключ не найден');
  }

  async deletePasskey(userId: string, id: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const total = await this.prisma.webAuthnCredential.count({ where: { userId } });
    // Deleting the last passkey on an account with no other way in would
    // lock the person out of their own account permanently.
    if (total <= 1 && !user.passwordHash && !user.telegramId && !user.googleId) {
      throw new BadRequestException(
        'Это единственный способ входа в аккаунт — сначала задайте пароль',
      );
    }
    const result = await this.prisma.webAuthnCredential.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw new NotFoundException('Ключ не найден');
  }
}

/** Groups of four keep a code readable and typable off a printout. */
function formatBackupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `${pick()}-${pick()}`;
}

/** Compared case- and dash-insensitively: someone reading off paper shouldn't have to match punctuation. */
function normalizeBackupCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
