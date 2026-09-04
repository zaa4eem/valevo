import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { DigestService } from './digest.service';
import { TelegramNotifyService } from '../common/telegram-notify.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Digest (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;

  beforeAll(async () => {
    process.env.DIGEST_CHAT_ID = '999999999';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const email = `digest-owner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Digest Owner' });
    await prisma.user.update({ where: { email }, data: { role: 'OWNER' } });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' });
    ownerToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks a non-owner from triggering the digest', async () => {
    const email = `digest-sub-${Date.now()}@test.dev`;
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Subscriber' });

    await request(app.getHttpServer())
      .post('/api/admin/digest/send-now')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .expect(403);
  });

  it('builds a digest covering a fresh idea, score, and Premium purchase from the last 3 days', async () => {
    const email = `digest-player-${Date.now()}@test.dev`;
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Digest Player' });
    const token = registerRes.body.accessToken as string;
    const userId = registerRes.body.user.id as string;

    // Top-idea selection is by voteCount across the whole (shared) test DB —
    // force this idea to the top regardless of what other suites left behind.
    const uniqueTitle = `Тестовая идея дайджеста ${Date.now()}`;
    const ideaRes = await request(app.getHttpServer())
      .post('/api/ideas')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: uniqueTitle, description: 'Проверка дайджеста' })
      .expect(201);
    await prisma.idea.update({ where: { id: ideaRes.body.id }, data: { voteCount: 999_999 } });

    // Must stay within maxPlausibleScore (else it's HELD_FOR_REVIEW and
    // excluded from both the leaderboard and the digest) — use the top of
    // the plausible range so it still outranks whatever other suites left behind.
    const game = await prisma.game.findUniqueOrThrow({ where: { slug: 'neon-snake' } });
    const uniqueScore = game.maxPlausibleScore - 1;
    await prisma.score.create({
      data: { gameId: game.id, userId, value: uniqueScore, reviewState: 'NORMAL' },
    });

    await prisma.user.update({ where: { id: userId }, data: { zCoins: 22222 } });
    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/admin/digest/send-now')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    expect(res.body.sent).toBe(true);
    expect(res.body.text).toContain(uniqueTitle);
    expect(res.body.text).toContain(String(uniqueScore));
    expect(res.body.text).toContain('Digest Player');
  });

  it('skips sending when no chat id is configured', async () => {
    const telegram = app.get(TelegramNotifyService);
    const service = new DigestService(prisma, telegram, { get: () => undefined } as any);
    const result = await service.sendDigest();
    expect(result).toBeNull();
  });
});
