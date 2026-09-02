import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Games (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const gameSlug = 'neon-snake';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.game.upsert({
      where: { slug: gameSlug },
      update: {},
      create: {
        slug: gameSlug,
        title: 'Neon Snake',
        description: 'Classic snake, zaa4eem style.',
        maxPlausibleScore: 500,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser(email: string) {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Player' });
    return res.body.accessToken as string;
  }

  it('holds an implausible score for review instead of publishing it', async () => {
    const token = await registerUser(`cheater-${Date.now()}@test.dev`);

    await request(app.getHttpServer())
      .post(`/api/games/${gameSlug}/scores`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 999_999 })
      .expect(201);

    const board = await request(app.getHttpServer())
      .get(`/api/games/${gameSlug}/leaderboard`)
      .expect(200);

    expect(board.body.every((entry: any) => entry.value <= 500)).toBe(true);
  });

  it('publishes a normal score to the per-game leaderboard', async () => {
    const token = await registerUser(`player-${Date.now()}@test.dev`);

    await request(app.getHttpServer())
      .post(`/api/games/${gameSlug}/scores`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 42 })
      .expect(201);

    const board = await request(app.getHttpServer())
      .get(`/api/games/${gameSlug}/leaderboard`)
      .expect(200);

    expect(board.body.some((entry: any) => entry.value === 42)).toBe(true);
  });
});
