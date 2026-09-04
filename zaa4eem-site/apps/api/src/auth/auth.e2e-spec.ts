import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Auth password reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
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
