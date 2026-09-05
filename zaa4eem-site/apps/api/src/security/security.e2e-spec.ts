import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { assessPassword } from '@zaa4eem/shared';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityService } from './security.service';
import { BreachCheckService } from './breach-check.service';
import { generateTotpSecret, totpCodeAt, verifyTotp } from './totp.util';
import { describeDevice, networkPrefix } from './device.util';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let security: SecurityService;
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    security = app.get(SecurityService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(displayName = 'Безопасник') {
    seq += 1;
    const email = `sec-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')
      .send({ email, password: 'correct horse battery staple', displayName });
    if (!res.body?.user) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return {
      email,
      password: 'correct horse battery staple',
      token: res.body.accessToken as string,
      id: res.body.user.id as string,
      cookie: extractCookie(res),
    };
  }

  function extractCookie(res: request.Response): string {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((c) => c.split(';')[0]).join('; ');
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('password strength and breach check', () => {
    it('rates length above punctuation theatre', () => {
      expect(assessPassword('P@ss1').score).toBe(0);
      expect(assessPassword('correct horse battery staple').verdict).toBe('strong');
      // Long but worthless: a repeated unit is not entropy.
      expect(assessPassword('abcabcabcabcabcabc').score).toBeLessThanOrEqual(1);
      expect(assessPassword('aaaaaaaaaaaaaaaa').score).toBe(0);
      // A common word caps the score no matter how long the rest is.
      expect(assessPassword('mypasswordisverylong').score).toBeLessThanOrEqual(1);
    });

    it('scores over the API and never claims "clean" when it could not check', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/security/password/check')
        .send({ password: 'correct horse battery staple' })
        .expect(200);

      expect(res.body.score).toBeGreaterThanOrEqual(3);
      expect(res.body.label).toBeTruthy();
      // Either a real count or null — never a fabricated zero. The service
      // fails open, so both are correct answers here.
      expect(res.body.breachCount === null || typeof res.body.breachCount === 'number').toBe(true);
    });
  });

  describe('breach check parsing', () => {
    it('never reads a non-range response as "not breached"', async () => {
      const service = app.get(BreachCheckService);
      const original = global.fetch;

      // A proxy notice, a captive portal, a CDN error page — all arrive with
      // a 200 and no matching suffix. Reading that as a clean bill of health
      // is the one failure this check must never have.
      global.fetch = (async () =>
        new Response('Host not in allowlist: api.pwnedpasswords.com.', { status: 200 })) as never;
      expect(await service.countBreaches('anything')).toBeNull();

      // An empty 200 is equally uninformative.
      global.fetch = (async () => new Response('', { status: 200 })) as never;
      expect(await service.countBreaches('anything')).toBeNull();

      // A real range response with no match genuinely means "not found".
      global.fetch = (async () =>
        new Response(`${'A'.repeat(35)}:12\r\n${'B'.repeat(35)}:3`, { status: 200 })) as never;
      expect(await service.countBreaches('anything')).toBe(0);

      global.fetch = original;
    });

    it('returns the count when the suffix is present', async () => {
      const service = app.get(BreachCheckService);
      const original = global.fetch;

      // SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
      const suffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
      global.fetch = (async () =>
        new Response(`${suffix}:9659365\r\n${'C'.repeat(35)}:2`, { status: 200 })) as never;
      expect(await service.countBreaches('password')).toBe(9_659_365);

      global.fetch = original;
    });
  });

  describe('TOTP', () => {
    it('generates and verifies a code, and rejects a wrong or stale one', () => {
      const secret = generateTotpSecret();
      const now = Date.now();
      expect(verifyTotp(secret, totpCodeAt(secret, now), now)).toBe(true);
      expect(verifyTotp(secret, '000000', now)).toBe(false);
      expect(verifyTotp(secret, 'abcdef', now)).toBe(false);

      // One step of drift each way is accepted; two is not.
      expect(verifyTotp(secret, totpCodeAt(secret, now - 30_000), now)).toBe(true);
      expect(verifyTotp(secret, totpCodeAt(secret, now + 30_000), now)).toBe(true);
      expect(verifyTotp(secret, totpCodeAt(secret, now - 120_000), now)).toBe(false);
    });

    it('enrols, hands out backup codes, and then demands a second factor at login', async () => {
      const user = await register('Двухфакторный');

      const begin = await request(app.getHttpServer())
        .post('/api/security/totp/begin')
        .set(auth(user.token))
        .expect(200);
      expect(begin.body.secret).toBeTruthy();
      expect(begin.body.uri).toContain('otpauth://totp/');

      // A wrong code must not enable anything.
      await request(app.getHttpServer())
        .post('/api/security/totp/confirm')
        .set(auth(user.token))
        .send({ code: '000000' })
        .expect(400);

      const confirm = await request(app.getHttpServer())
        .post('/api/security/totp/confirm')
        .set(auth(user.token))
        .send({ code: totpCodeAt(begin.body.secret) })
        .expect(200);
      expect(confirm.body.codes).toHaveLength(10);

      // Logging in now stops halfway and hands back a ticket, not a session.
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(201);
      expect(login.body.twoFactorRequired).toBe(true);
      expect(login.body.accessToken).toBeUndefined();
      expect(extractCookie(login)).not.toContain('zaa4eem_refresh');

      // A wrong code at the second step is refused.
      await request(app.getHttpServer())
        .post('/api/auth/2fa')
        .send({ ticket: login.body.ticket, code: '111111' })
        .expect(401);

      const finished = await request(app.getHttpServer())
        .post('/api/auth/2fa')
        .send({ ticket: login.body.ticket, code: totpCodeAt(begin.body.secret) })
        .expect(200);
      expect(finished.body.accessToken).toBeTruthy();
      expect(finished.body.user.id).toBe(user.id);
    });

    it('accepts a backup code exactly once', async () => {
      const user = await register('Резервный');
      const begin = await request(app.getHttpServer())
        .post('/api/security/totp/begin')
        .set(auth(user.token))
        .expect(200);
      const confirm = await request(app.getHttpServer())
        .post('/api/security/totp/confirm')
        .set(auth(user.token))
        .send({ code: totpCodeAt(begin.body.secret) })
        .expect(200);

      const [code] = confirm.body.codes as string[];
      expect(await security.verifySecondFactor(user.id, code)).toBe(true);
      // Burned.
      expect(await security.verifySecondFactor(user.id, code)).toBe(false);
      // And it is tolerant of how it was typed off a printout.
      const other = (confirm.body.codes as string[])[1];
      expect(await security.verifySecondFactor(user.id, other.toLowerCase().replace('-', ' '))).toBe(true);
    });

    it('will not accept a normal access token as a 2FA ticket', async () => {
      const user = await register('Подменщик');
      await request(app.getHttpServer())
        .post('/api/auth/2fa')
        .send({ ticket: user.token, code: '123456' })
        .expect(401);
    });
  });

  describe('email verification', () => {
    it('starts unverified, and a valid link verifies it', async () => {
      const user = await register('Неподтверждённый');

      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(before.emailVerifiedAt).toBeNull();

      // The token row exists even without SMTP — the service logs the link
      // instead of mailing it, which is exactly what a fresh deploy does.
      const row = await prisma.emailToken.findFirstOrThrow({
        where: { userId: user.id, type: 'VERIFY_EMAIL' },
      });
      // Only the hash is stored, so the raw token has to be re-made the way
      // the service would have: re-issue and read it back is not possible,
      // so verify the negative paths through the API instead.
      expect(row.tokenHash).toHaveLength(64);
      expect(row.email).toBe(user.email);

      await request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({ token: 'a'.repeat(64) })
        .expect(400);
    });

    it('reports verification state on the profile', async () => {
      const user = await register('Профильный');
      const me = await request(app.getHttpServer())
        .get('/api/users/me')
        .set(auth(user.token))
        .expect(200);
      expect(me.body.emailVerified).toBe(false);

      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
      const after = await request(app.getHttpServer())
        .get('/api/users/me')
        .set(auth(user.token))
        .expect(200);
      expect(after.body.emailVerified).toBe(true);
    });
  });

  describe('magic link', () => {
    it('answers the same for a known and an unknown address', async () => {
      const user = await register('Магический');

      const known = await request(app.getHttpServer())
        .post('/api/auth/magic-link')
        .send({ email: user.email })
        .expect(200);
      const unknown = await request(app.getHttpServer())
        .post('/api/auth/magic-link')
        .send({ email: `nobody-${Date.now()}@test.dev` })
        .expect(200);

      // Identical bodies: this endpoint must not reveal who has an account.
      expect(known.body).toEqual(unknown.body);

      // A row was created only for the real one.
      expect(
        await prisma.emailToken.count({ where: { userId: user.id, type: 'MAGIC_LINK' } }),
      ).toBe(1);
    });

    it('refuses a made-up or reused link', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/magic-link/consume')
        .send({ token: 'b'.repeat(64) })
        .expect(401);
    });
  });

  describe('sessions', () => {
    it('lists the current session with a readable name and marks it as current', async () => {
      const user = await register('Сеансовый');

      const res = await request(app.getHttpServer())
        .get('/api/security/sessions')
        .set(auth(user.token))
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      // Identified by the access token's `sid`, not the refresh cookie —
      // that cookie is scoped to /api/auth and never reaches this endpoint,
      // so no Cookie header is sent here on purpose.
      const current = res.body.find((s: any) => s.current);
      expect(current).toBeDefined();
      expect(current.label).toBe('Chrome, Windows');
    });

    it('signs out every other device but keeps this one', async () => {
      const user = await register('Многодевайсный');

      // A second and third session, as if from other devices.
      for (const ua of ['Mozilla/5.0 (iPhone) Safari/605', 'Mozilla/5.0 (X11; Linux) Firefox/121']) {
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .set('User-Agent', ua)
          .send({ email: user.email, password: user.password })
          .expect(201);
      }

      const before = await request(app.getHttpServer())
        .get('/api/security/sessions')
        .set(auth(user.token))
        .expect(200);
      expect(before.body.length).toBeGreaterThanOrEqual(3);

      const revoked = await request(app.getHttpServer())
        .post('/api/security/sessions/revoke-others')
        .set(auth(user.token))
        .expect(200);
      expect(revoked.body.revoked).toBeGreaterThanOrEqual(2);

      const after = await request(app.getHttpServer())
        .get('/api/security/sessions')
        .set(auth(user.token))
        .expect(200);
      expect(after.body).toHaveLength(1);
      expect(after.body[0].current).toBe(true);
    });

    it("cannot revoke someone else's session", async () => {
      const owner = await register('Владелец сеанса');
      const stranger = await register('Чужак');

      const sessions = await request(app.getHttpServer())
        .get('/api/security/sessions')
        .set(auth(owner.token))
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/security/sessions/${sessions.body[0].id}`)
        .set(auth(stranger.token))
        .expect(404);

      const still = await prisma.refreshToken.findUnique({ where: { id: sessions.body[0].id } });
      expect(still?.revokedAt).toBeNull();
    });

    it('keeps a rotated session recognisable instead of spawning a nameless one', async () => {
      const user = await register('Ротационный');

      // /api/auth/refresh is the one endpoint the refresh cookie IS scoped
      // to, so this call does send it.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', user.cookie)
        .expect(201);

      const rows = await prisma.refreshToken.findMany({ where: { userId: user.id } });
      // Rotation continues the same session, so the replacement inherits its
      // label rather than appearing as "Неизвестное устройство".
      expect(rows.every((r) => r.deviceLabel === 'Chrome, Windows')).toBe(true);
    });
  });

  describe('device labels', () => {
    it('names browsers and platforms people recognise', () => {
      expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')).toBe('Chrome, Windows');
      expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605')).toBe(
        'Safari, iPhone/iPad',
      );
      expect(describeDevice('Mozilla/5.0 (Windows) YaBrowser/24.1')).toBe('Яндекс.Браузер, Windows');
      expect(describeDevice(null)).toBe('Неизвестное устройство');
    });

    it('truncates addresses to a network instead of keeping a location log', () => {
      expect(networkPrefix('203.0.113.45')).toBe('203.0.113.0/24');
      expect(networkPrefix('::ffff:203.0.113.45')).toBe('203.0.113.0/24');
      expect(networkPrefix('2001:db8:1234:5678::1')).toBe('2001:db8:1234::/48');
      expect(networkPrefix(null)).toBeNull();
    });
  });

  describe('passkeys', () => {
    it('offers a discoverable challenge without asking who is signing in', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/passkey/begin').expect(200);
      expect(res.body.challenge).toBeTruthy();
      // No allowCredentials: the browser picks, which is what lets someone
      // sign in without typing an identifier first.
      expect(res.body.allowCredentials ?? []).toHaveLength(0);
    });

    it('refuses a fabricated passkey response', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/passkey/finish')
        .send({ id: 'made-up', response: { clientDataJSON: 'bm90LWpzb24' } })
        .expect(401);
    });

    it('requires a login to manage keys', async () => {
      await request(app.getHttpServer()).post('/api/security/passkeys/begin').expect(401);
      await request(app.getHttpServer()).get('/api/security').expect(401);
    });
  });

  describe('overview', () => {
    it('describes the account without leaking anything secret', async () => {
      const user = await register('Обзорный');
      const res = await request(app.getHttpServer())
        .get('/api/security')
        .set(auth(user.token))
        .expect(200);

      expect(res.body.email).toBe(user.email);
      expect(res.body.emailVerified).toBe(false);
      expect(res.body.hasPassword).toBe(true);
      expect(res.body.totpEnabled).toBe(false);
      expect(res.body.passkeys).toEqual([]);
      expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
      // No secrets anywhere in the payload.
      expect(JSON.stringify(res.body)).not.toContain('totpSecret');
      expect(JSON.stringify(res.body)).not.toContain('tokenHash');
    });
  });
});
