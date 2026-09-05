import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import { describeDevice } from './device.util';

/** A challenge is worthless after a minute; anything longer is just a bigger replay window. */
const CHALLENGE_TTL_MS = 60_000;

/**
 * Passkeys.
 *
 * The reason this is worth the code: a passkey cannot be phished, reused
 * across sites, guessed, or read out of a breach dump — the private half
 * never leaves the device, and the signature is bound to this origin. It is
 * the only login here that is strictly better than a password rather than a
 * different trade-off.
 *
 * Two flows: registration (adding a key to an account you are already in)
 * and authentication (signing in with one). Authentication is discoverable
 * — the browser offers the account, so the user never types an identifier.
 */
@Injectable()
export class WebAuthnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The Relying Party ID must be the registrable domain (no scheme, no
   * port), and origin must match exactly what the browser sends. Derived
   * from the same config the rest of the app uses so a deploy can't end up
   * with a passkey bound to a hostname nobody visits.
   */
  private relyingParty() {
    const origin = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000').split(',')[0].trim();
    let rpID: string;
    try {
      rpID = new URL(origin).hostname;
    } catch {
      rpID = 'localhost';
    }
    return { rpID, origin, rpName: 'ZAA4EEM' };
  }

  private async storeChallenge(challenge: string, userId?: string): Promise<void> {
    await this.prisma.webAuthnChallenge.create({
      data: { challenge, userId: userId ?? null, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    // Opportunistic sweep — no scheduled job for a table this small.
    await this.prisma.webAuthnChallenge
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);
  }

  /** Single-use: consumed by the delete, so a captured challenge can't be replayed. */
  private async consumeChallenge(challenge: string): Promise<{ userId: string | null } | null> {
    const row = await this.prisma.webAuthnChallenge.findUnique({ where: { challenge } });
    if (!row) return null;
    await this.prisma.webAuthnChallenge.delete({ where: { id: row.id } }).catch(() => undefined);
    if (row.expiresAt < new Date()) return null;
    return { userId: row.userId };
  }

  async beginRegistration(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const existing = await this.prisma.webAuthnCredential.findMany({ where: { userId } });
    const { rpID, rpName } = this.relyingParty();

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(user.id),
      userName: user.email ?? user.displayName,
      userDisplayName: user.displayName,
      attestationType: 'none',
      // Stops the same authenticator being registered twice, which would
      // show up as two identical-looking keys the user can't tell apart.
      excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await this.storeChallenge(options.challenge, userId);
    return options;
  }

  async finishRegistration(userId: string, response: unknown, userAgent?: string | null) {
    const body = response as { response?: unknown; id?: string };
    if (!body || typeof body !== 'object') throw new BadRequestException('Некорректный ответ ключа');

    const { rpID, origin } = this.relyingParty();
    const challenge = extractChallenge(body);
    if (!challenge) throw new BadRequestException('Не удалось прочитать ответ ключа');

    const stored = await this.consumeChallenge(challenge);
    if (!stored || stored.userId !== userId) {
      throw new BadRequestException('Запрос устарел — начните заново');
    }

    const verification = await verifyRegistrationResponse({
      response: body as never,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Ключ не прошёл проверку');
    }

    const { credential } = verification.registrationInfo;
    await this.prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports?.join(',') ?? null,
        label: describeDevice(userAgent),
      },
    });
  }

  async beginAuthentication() {
    const { rpID } = this.relyingParty();
    // No allowCredentials: the browser picks from what it holds for this
    // site, which is what lets someone sign in without typing anything.
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    await this.storeChallenge(options.challenge);
    return options;
  }

  /** Returns the user id the passkey belongs to. */
  async finishAuthentication(response: unknown): Promise<string> {
    const body = response as { id?: string };
    if (!body?.id) throw new UnauthorizedException('Некорректный ответ ключа');

    const challenge = extractChallenge(body);
    if (!challenge) throw new UnauthorizedException('Не удалось прочитать ответ ключа');

    const stored = await this.consumeChallenge(challenge);
    if (!stored) throw new UnauthorizedException('Запрос устарел — попробуйте ещё раз');

    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: body.id },
    });
    if (!credential) throw new UnauthorizedException('Этот ключ не привязан ни к одному аккаунту');

    const { rpID, origin } = this.relyingParty();
    const verification = await verifyAuthenticationResponse({
      response: body as never,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: (credential.transports?.split(',') as never) ?? undefined,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) throw new UnauthorizedException('Ключ не прошёл проверку');

    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        // A counter that fails to advance is the signature of a cloned
        // authenticator; the library rejects that before we get here.
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    return credential.userId;
  }
}

/**
 * The challenge the authenticator signed is inside clientDataJSON, and it is
 * what ties this response to the one we issued — reading it here lets the
 * challenge be looked up server-side instead of being carried in a session.
 */
function extractChallenge(body: unknown): string | null {
  const clientDataJSON = (body as { response?: { clientDataJSON?: string } })?.response
    ?.clientDataJSON;
  if (typeof clientDataJSON !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
    return typeof parsed?.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}
