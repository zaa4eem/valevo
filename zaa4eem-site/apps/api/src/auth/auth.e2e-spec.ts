import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { GoogleAuthService } from './google-auth.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Auth password reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds the same way whether or not the email is registered', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: `nobody-${Date.now()}@test.dev` })
      .expect(200);
  });

  it('resets the password with a valid token, and the old password stops working', async () => {
    const email = `reset-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'oldpassword123', displayName: 'Reset Me' });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const rawToken = await tokens.issuePasswordResetToken(user.id);

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'newpassword456' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'oldpassword123' })
      .expect(401);

    const relogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'newpassword456' });
    expect(relogin.body.accessToken).toBeDefined();
  });

  it('rejects a reused reset token', async () => {
    const email = `reset2-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'oldpassword123', displayName: 'Reset Twice' });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const rawToken = await tokens.issuePasswordResetToken(user.id);

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'firstchange123' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'secondchange456' })
      .expect(401);
  });

  it('rejects an unknown reset token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'whatever123' })
      .expect(401);
  });

  function refreshCookieFrom(res: request.Response): string {
    const raw = res.headers['set-cookie'];
    const list: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const cookie = list.find((c) => c.startsWith('zaa4eem_refresh='));
    if (!cookie) throw new Error('No zaa4eem_refresh cookie in response');
    return cookie.split(';')[0];
  }

  it('rotates the refresh cookie on use, and the old one stops working', async () => {
    const email = `refresh-${Date.now()}@test.dev`;
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Refresh Me' });
    const firstCookie = refreshCookieFrom(register);

    const refreshed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(201);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    const secondCookie = refreshCookieFrom(refreshed);
    expect(secondCookie).not.toBe(firstCookie);

    // The new cookie works on its own...
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', secondCookie).expect(201);

    // ...but replaying the rotated-away original is treated as a possible
    // stolen token and revokes the whole account's sessions, this one
    // (now-rotated-again) included — see the dedicated replay-detection
    // test below for that behavior specifically.
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', firstCookie).expect(401);
  });

  it('replaying an already-rotated refresh token revokes every other active session for that user', async () => {
    const email = `refresh-replay-${Date.now()}@test.dev`;
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Replay Me' });
    const sessionACookie = refreshCookieFrom(register);

    // A second, independent login — simulates the user's other device/tab.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    const sessionBCookie = refreshCookieFrom(login);

    // Rotate session A normally once (as the legitimate flow would).
    const refreshedA = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', sessionACookie)
      .expect(201);
    const sessionACookieRotated = refreshCookieFrom(refreshedA);

    // Now replay the STALE, already-rotated session A cookie — e.g. a
    // stolen copy used after the legitimate client already moved on.
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', sessionACookie).expect(401);

    // Session A's real successor and session B (an entirely different,
    // never-misused session) must both be dead now too — the whole
    // account's sessions get revoked on a detected replay, not just the
    // one bad token.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', sessionACookieRotated)
      .expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', sessionBCookie).expect(401);
  });
});

(canRun ? describe : describe.skip)('One account everywhere: bot-code Telegram linking (e2e)', () => {
  let app: INestApplication;
  const botAuth = `Bearer ${process.env.TELEGRAM_BOT_TOKEN}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser() {
    const email = `link-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Link Me' });
    return res.body.accessToken as string;
  }

  it('issues a 6-digit code only to a logged-in user', async () => {
    await request(app.getHttpServer()).post('/api/auth/link/telegram/code').expect(401);

    const token = await registerUser();
    const res = await request(app.getHttpServer())
      .post('/api/auth/link/telegram/code')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(res.body.code).toMatch(/^\d{6}$/);
    expect(res.body.expiresInMinutes).toBe(10);
  });

  it('lets the bot redeem a valid code and links the Telegram id', async () => {
    const token = await registerUser();
    const issue = await request(app.getHttpServer())
      .post('/api/auth/link/telegram/code')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const telegramId = Date.now();
    const res = await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', botAuth)
      .send({ code: issue.body.code, telegramId, telegramUsername: 'linked_user' })
      .expect(201);

    expect(res.body.hasTelegram).toBe(true);
    expect(res.body.telegramUsername).toBe('linked_user');
  });

  it('rejects the consume endpoint without the bot secret', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .send({ code: '123456', telegramId: 1 })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', 'Bearer wrong-token')
      .send({ code: '123456', telegramId: 1 })
      .expect(401);
  });

  it('rejects a code that was already used', async () => {
    const token = await registerUser();
    const issue = await request(app.getHttpServer())
      .post('/api/auth/link/telegram/code')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', botAuth)
      .send({ code: issue.body.code, telegramId: Date.now() })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', botAuth)
      .send({ code: issue.body.code, telegramId: Date.now() + 1 })
      .expect(401);
  });

  it('rejects a malformed code', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', botAuth)
      .send({ code: 'abcdef', telegramId: 1 })
      .expect(400);
  });

  it('generating a new code invalidates the previous unused one', async () => {
    const token = await registerUser();
    const first = await request(app.getHttpServer())
      .post('/api/auth/link/telegram/code')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/code')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', botAuth)
      .send({ code: first.body.code, telegramId: Date.now() })
      .expect(401);
  });

  it('rejects linking a Telegram id already linked to a different account', async () => {
    const tokenA = await registerUser();
    const telegramId = Date.now();
    const issueA = await request(app.getHttpServer())
      .post('/api/auth/link/telegram/code')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', botAuth)
      .send({ code: issueA.body.code, telegramId })
      .expect(201);

    const tokenB = await registerUser();
    const issueB = await request(app.getHttpServer())
      .post('/api/auth/link/telegram/code')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/link/telegram/consume')
      .set('Authorization', botAuth)
      .send({ code: issueB.body.code, telegramId })
      .expect(409);
  });
});

(canRun ? describe : describe.skip)('Google sign-in (e2e)', () => {
  let app: INestApplication;
  let verifyIdToken: jest.Mock;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleAuthService)
      .useValue({ verifyIdToken: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    verifyIdToken = (moduleRef.get(GoogleAuthService) as unknown as { verifyIdToken: jest.Mock }).verifyIdToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  function googlePayload(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      googleId: `g-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      email: undefined,
      emailVerified: false,
      displayName: 'Google User',
      avatarUrl: 'https://example.com/avatar.png',
      ...overrides,
    };
  }

  it('creates a new account on first sign-in', async () => {
    verifyIdToken.mockResolvedValueOnce(googlePayload({ displayName: 'Fresh Googler' }));

    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ credential: 'fake-jwt' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.displayName).toBe('Fresh Googler');
  });

  it('signs into the same account on a repeat sign-in with the same googleId', async () => {
    const payload = googlePayload({ displayName: 'Repeat Googler' });
    verifyIdToken.mockResolvedValueOnce(payload);
    const first = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ credential: 'fake-jwt-1' })
      .expect(201);

    verifyIdToken.mockResolvedValueOnce(payload);
    const second = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ credential: 'fake-jwt-2' })
      .expect(201);

    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('links to an existing account by verified email instead of creating a duplicate', async () => {
    const email = `google-link-${Date.now()}@test.dev`;
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Original Account' });

    verifyIdToken.mockResolvedValueOnce(
      googlePayload({ email, emailVerified: true, displayName: 'Ignored Google Name' }),
    );
    const googleLogin = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ credential: 'fake-jwt' })
      .expect(201);

    expect(googleLogin.body.user.id).toBe(registered.body.user.id);
    expect(googleLogin.body.user.displayName).toBe('Original Account');
  });

  it('does not link when the email is unverified, even if it matches an existing account', async () => {
    const email = `google-unverified-${Date.now()}@test.dev`;
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Real Owner' });

    verifyIdToken.mockResolvedValueOnce(googlePayload({ email, emailVerified: false }));
    const googleLogin = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ credential: 'fake-jwt' })
      .expect(201);

    expect(googleLogin.body.user.id).not.toBe(registered.body.user.id);
  });

  it('rejects when Google token verification fails', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('Токен просрочен'));

    await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ credential: 'garbage' })
      .expect(401);
  });

  it('rejects a request with no credential', async () => {
    await request(app.getHttpServer()).post('/api/auth/google').send({}).expect(400);
  });
});
