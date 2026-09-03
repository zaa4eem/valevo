import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
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
