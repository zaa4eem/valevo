import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Integration test against a real Postgres instance. Requires DATABASE_URL
 * (and JWT_ACCESS_SECRET / TELEGRAM_BOT_TOKEN) to be set — see
 * infra/.env.example. Skipped automatically when DATABASE_URL is absent so
 * `npm test` still passes in environments without a database (e.g. this
 * sandbox); run it for real via `docker compose up -d postgres` locally.
 */
const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Ideas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser(email: string, displayName: string) {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName });
    return res.body.accessToken as string;
  }

  it('lets a user submit an idea and appear on the public board', async () => {
    const token = await registerUser(`submitter-${Date.now()}@test.dev`, 'Submitter');

    const created = await request(app.getHttpServer())
      .post('/api/ideas')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Add a dark mode toggle', description: 'Some users prefer pure black.' })
      .expect(201);

    expect(created.body.status).toBe('NEW');

    const board = await request(app.getHttpServer()).get('/api/ideas').expect(200);
    expect(board.body.some((idea: any) => idea.id === created.body.id)).toBe(true);
  });

  it('rejects a second vote from the same user with 409', async () => {
    const authorToken = await registerUser(`author-${Date.now()}@test.dev`, 'Author');
    const voterToken = await registerUser(`voter-${Date.now()}@test.dev`, 'Voter');

    const idea = await request(app.getHttpServer())
      .post('/api/ideas')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ title: 'Add weekly leaderboard reset', description: 'Keeps the board fresh.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/ideas/${idea.body.id}/vote`)
      .set('Authorization', `Bearer ${voterToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/ideas/${idea.body.id}/vote`)
      .set('Authorization', `Bearer ${voterToken}`)
      .expect(409);
  });

  it('forbids a non-owner from changing an idea status', async () => {
    const token = await registerUser(`nonowner-${Date.now()}@test.dev`, 'Non Owner');
    const idea = await request(app.getHttpServer())
      .post('/api/ideas')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Add push notifications', description: 'For new idea replies.' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/ideas/${idea.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACCEPTED' })
      .expect(403);
  });
});
