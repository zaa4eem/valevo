import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { CLICKER_DAILY_CAP, PREMIUM_SHOP_PRICE, clickerUpgradeCost } from '@zaa4eem/shared';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Z-Coin clicker + shop (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser() {
    const email = `clicker-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Clicker Player' });
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  it('rejects unauthenticated access to state/click/upgrade', async () => {
    await request(app.getHttpServer()).get('/api/clicker/state').expect(401);
    await request(app.getHttpServer()).post('/api/clicker/click').send({ count: 1 }).expect(401);
    await request(app.getHttpServer()).post('/api/clicker/upgrade').expect(401);
    await request(app.getHttpServer()).post('/api/shop/premium').expect(401);
  });

  it('starts a fresh account at 0 coins, clickPower 1, with the right upgrade cost', async () => {
    const { token } = await registerUser();
    const res = await request(app.getHttpServer())
      .get('/api/clicker/state')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      zCoins: 0,
      clickPower: 1,
      coinsEarnedToday: 0,
      dailyCap: CLICKER_DAILY_CAP,
      nextUpgradeCost: clickerUpgradeCost(1),
      isPremium: false,
    });
  });

  it('awards clickPower coins per click and rejects an out-of-range batch count', async () => {
    const { token } = await registerUser();

    const res = await request(app.getHttpServer())
      .post('/api/clicker/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 10 })
      .expect(201);

    expect(res.body.awarded).toBe(10);
    expect(res.body.zCoins).toBe(10);
    expect(res.body.coinsEarnedToday).toBe(10);
    expect(res.body.capped).toBe(false);

    await request(app.getHttpServer())
      .post('/api/clicker/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/clicker/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 51 })
      .expect(400);
  });

  it('caps daily earnings at CLICKER_DAILY_CAP even across many click batches', async () => {
    const { token } = await registerUser();

    const first = await request(app.getHttpServer())
      .post('/api/clicker/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 50 })
      .expect(201);
    expect(first.body.awarded).toBe(50);

    // Hammer it with enough batches to blow well past the cap.
    let last;
    for (let i = 0; i < 45; i++) {
      last = await request(app.getHttpServer())
        .post('/api/clicker/click')
        .set('Authorization', `Bearer ${token}`)
        .send({ count: 50 })
        .expect(201);
    }

    expect(last!.body.zCoins).toBe(CLICKER_DAILY_CAP);
    expect(last!.body.coinsEarnedToday).toBe(CLICKER_DAILY_CAP);

    // One more click once fully capped: awarded 0, capped true, balance unchanged.
    const overCap = await request(app.getHttpServer())
      .post('/api/clicker/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5 })
      .expect(201);
    expect(overCap.body.awarded).toBe(0);
    expect(overCap.body.capped).toBe(true);
    expect(overCap.body.zCoins).toBe(CLICKER_DAILY_CAP);
  });

  it('lets a user buy a click-power upgrade once they can afford it, and rejects it otherwise', async () => {
    const { token } = await registerUser();

    const cost = clickerUpgradeCost(1);
    await request(app.getHttpServer())
      .post('/api/clicker/upgrade')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/clicker/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: cost })
      .expect(201);

    const upgraded = await request(app.getHttpServer())
      .post('/api/clicker/upgrade')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(upgraded.body.clickPower).toBe(2);
    expect(upgraded.body.zCoins).toBe(0);
    expect(upgraded.body.nextUpgradeCost).toBe(clickerUpgradeCost(2));
  });

  it('surfaces top zCoin holders on the clicker leaderboard', async () => {
    const { token, userId } = await registerUser();
    await request(app.getHttpServer())
      .post('/api/clicker/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 33 })
      .expect(201);

    const board = await request(app.getHttpServer()).get('/api/clicker/leaderboard').expect(200);
    const entry = board.body.find((e: any) => e.userId === userId);
    expect(entry).toBeDefined();
    expect(entry.value).toBe(33);
  });

  it('sells Premium for PREMIUM_SHOP_PRICE, rejecting insufficient funds and a repeat purchase', async () => {
    const { token, userId } = await registerUser();

    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    // Simulate having ground out the daily cap for many days rather than
    // actually looping the test for real days — set the balance directly.
    await prisma.user.update({ where: { id: userId }, data: { zCoins: PREMIUM_SHOP_PRICE } });

    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const state = await request(app.getHttpServer())
      .get('/api/clicker/state')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(state.body.isPremium).toBe(true);
    expect(state.body.zCoins).toBe(0);

    await prisma.user.update({ where: { id: userId }, data: { zCoins: PREMIUM_SHOP_PRICE } });
    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });
});
