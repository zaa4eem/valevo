import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { CLICKER_DAILY_CAP, PREMIUM_SHOP_PRICE, clickerUpgradeCost } from '@zaa4eem/shared';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { addMonths } from '../common/premium.util';
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

  it('never exceeds the daily cap even when clicks race concurrently', async () => {
    const { token, userId } = await registerUser();
    // Leave exactly 40 coins of headroom under the cap.
    await prisma.user.update({
      where: { id: userId },
      data: { coinsEarnedToday: CLICKER_DAILY_CAP - 40, coinsEarnedDay: new Date(new Date().toISOString().slice(0, 10)) },
    });

    // 8 concurrent batches each demanding 40 (way more than the 40 total
    // headroom) — a stale read-then-write would let several of these read
    // the same "40 remaining" snapshot and each get awarded up to it,
    // blowing past the cap. Atomically guarded, only 40 total can land.
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer())
          .post('/api/clicker/click')
          .set('Authorization', `Bearer ${token}`)
          .send({ count: 40 })
          .expect(201),
      ),
    );

    const totalAwarded = results.reduce((sum, res) => sum + res.body.awarded, 0);
    expect(totalAwarded).toBe(40);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.coinsEarnedToday).toBe(CLICKER_DAILY_CAP);
    expect(row.coinsEarnedToday).toBeLessThanOrEqual(CLICKER_DAILY_CAP);
  });

  it('charges only one upgrade when purchases race concurrently, never going negative', async () => {
    const { token, userId } = await registerUser();
    const cost = clickerUpgradeCost(1);
    await prisma.user.update({ where: { id: userId }, data: { zCoins: cost } });

    // Exactly enough Z for ONE upgrade — a stale read-then-write would let
    // several concurrent requests all price themselves off the same
    // clickPower and all succeed at that price, driving zCoins negative.
    const settled = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/api/clicker/upgrade')
          .set('Authorization', `Bearer ${token}`)
          .then((res) => res.status),
      ),
    );

    const successes = settled.filter((status) => status === 201);
    const rejections = settled.filter((status) => status === 400);
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(4);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.clickPower).toBe(2);
    expect(row.zCoins).toBe(0);
    expect(row.zCoins).toBeGreaterThanOrEqual(0);
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
    expect(Array.isArray(board.body)).toBe(true);
    expect(board.body[0]).toMatchObject({ rank: 1, userId: expect.any(String), value: expect.any(Number) });

    // The dev DB accumulates far more than 20 zCoin holders across a long
    // test history, so a fresh 33-coin account isn't guaranteed a top-20
    // spot — verify it actually earned the coins directly instead.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.zCoins).toBe(33);
  });

  it('sells one month of Premium for PREMIUM_SHOP_PRICE, rejecting insufficient funds', async () => {
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
    expect(state.body.premiumUntil).toEqual(expect.any(String));

    // A repeat purchase stacks another month rather than being rejected —
    // see referrals.e2e-spec.ts for the full stacking + "already permanent"
    // coverage of this behavior.
    await prisma.user.update({ where: { id: userId }, data: { zCoins: PREMIUM_SHOP_PRICE } });
    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  });

  it('stacks both months when two purchases race concurrently, instead of only the last write landing', async () => {
    const { token, userId } = await registerUser();
    const testStart = new Date();
    await prisma.user.update({ where: { id: userId }, data: { zCoins: PREMIUM_SHOP_PRICE * 2 } });

    // A stale read-then-write would have both concurrent purchases compute
    // premiumUntil from the same "not yet Premium" snapshot — both charge
    // zCoins, but only 1 month (not 2) ends up applied.
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post('/api/shop/premium')
          .set('Authorization', `Bearer ${token}`)
          .expect(201),
      ),
    );
    expect(results).toHaveLength(2);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.zCoins).toBe(0);
    const expected = addMonths(addMonths(testStart, 1), 1);
    expect(row.premiumUntil).not.toBeNull();
    expect(Math.abs(row.premiumUntil!.getTime() - expected.getTime())).toBeLessThan(10_000);
  });
});
