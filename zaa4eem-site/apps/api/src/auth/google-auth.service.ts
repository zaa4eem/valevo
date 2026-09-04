import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleUserPayload {
  googleId: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Wraps google-auth-library as its own injectable service (rather than a
 * plain function like telegram-verify.ts) purely so e2e tests can override
 * it via Nest's DI instead of hitting Google's real servers.
 */
@Injectable()
export class GoogleAuthService {
  private client: OAuth2Client | undefined;

  constructor(private readonly config: ConfigService) {}

  private getClient(): OAuth2Client {
    if (!this.client) {
      this.client = new OAuth2Client(this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'));
    }
    return this.client;
  }

  /**
   * Verifies a Google Identity Services ID token (the `credential` field
   * from its JS callback) — signature, issuer, audience and expiry are all
   * checked by google-auth-library against Google's published JWKS. Throws
   * on anything invalid; never trust the payload otherwise.
   */
  async verifyIdToken(credential: string): Promise<GoogleUserPayload> {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const ticket = await this.getClient().verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      throw new Error('Google не вернул идентификатор пользователя');
    }
    return {
      googleId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified ?? false,
      displayName: payload.name,
      avatarUrl: payload.picture,
    };
  }
}
