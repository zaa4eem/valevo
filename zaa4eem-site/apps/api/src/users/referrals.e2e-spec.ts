import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Referrals + Premium duration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let auth: AuthService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    users = app.get(UsersService);
    auth = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(displayName: string) {
    const email = `ref-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName })
      .expect(201);
    return { token: res.body.accessToken as string, user: res.body.user };
  }

  it('every new account gets a unique referralCode', async () => {
    const a = await register('Ref Owner A');
    const b = await register('Ref Owner B');
    expect(a.user.referralCode).toEqual(expect.any(String));
    expect(a.user.referralCode.length).toBeGreaterThan(0);
    expect(a.user.referralCode).not.toBe(b.user.referralCode);
  });

  it('attributes a web registration to the referrer and grants a 24h trial on the first successful referral only', async () => {
    const referrer = await register('Referrer One');

    const email1 = `ref-invitee1-${Date.now()}@test.dev`;
    const invitee1 = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: email1, password: 'password123', displayName: 'Invitee One', referralCode: referrer.user.referralCode })
      .expect(201);

    const referrerAfterFirst = await request(app.getHttpServer())
      .get(`/api/users/${referrer.user.id}`)
      .expect(200);
    expect(referrerAfterFirst.body.isPremium).toBe(true);
    expect(referrerAfterFirst.body.usedTrialPremium).toBe(true);
    expect(referrerAfterFirst.body.premiumUntil).toEqual(expect.any(String));

    const invitee1Profile = await request(app.getHttpServer())
      .get(`/api/users/${invitee1.body.user.id}`)
      .expect(200);
    // invitedById isn't in the public schema, but the reward it triggers already proved attribution — cross-check via DB directly too.
    const invitee1Row = await prisma.user.findUniqueOrThrow({ where: { id: invitee1.body.user.id } });
    expect(invitee1Row.invitedById).toBe(referrer.user.id);
    void invitee1Profile;

    // A SECOND referral by the same person must not grant a second trial.
    const email2 = `ref-invitee2-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: email2, password: 'password123', displayName: 'Invitee Two', referralCode: referrer.user.referralCode })
      .expect(201);

    const referrerRow = await prisma.user.findUniqueOrThrow({ where: { id: referrer.user.id } });
    const premiumUntilAfterFirst = referrerAfterFirst.body.premiumUntil;
    expect(referrerRow.premiumUntil?.toISOString()).toBe(premiumUntilAfterFirst);
  });

  it('silently ignores an unknown referral code instead of failing registration', async () => {
    const email = `ref-badcode-${Date.now()}@test.dev`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'No Such Referrer', referralCode: 'NOSUCH1' })
      .expect(201);
    expect(res.body.user.id).toEqual(expect.any(String));
  });

  it('bot pending-referral endpoint requires the bot token and is consumed by attributeReferralFromPending', async () => {
    const referrer = await register('Referrer Telegram');
    const telegramId = 555_000_000_000 + Date.now();

    await request(app.getHttpServer())
      .post('/api/auth/referral/pending')
      .send({ code: referrer.user.referralCode, telegramId })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/referral/pending')
      .set('Authorization', `Bearer ${process.env.TELEGRAM_BOT_TOKEN}`)
      .send({ code: referrer.user.referralCode, telegramId })
      .expect(200);

    const pending = await prisma.pendingReferral.findUnique({ where: { telegramId: BigInt(telegramId) } });
    expect(pending?.referrerId).toBe(referrer.user.id);

    // Simulate the account actually getting created moments later (skipping
    // Telegram initData signing here — that crypto is covered separately by
    // telegram-verify.spec.ts, and createFromTelegram/attributeReferralFromPending
    // are the same methods the real /auth/telegram flow calls).
    const newUser = await users.createFromTelegram({ telegramId: BigInt(telegramId), displayName: 'Telegram Invitee' });
    await users.attributeReferralFromPending(newUser.id, BigInt(telegramId));

    const newUserRow = await prisma.user.findUniqueOrThrow({ where: { id: newUser.id } });
    expect(newUserRow.invitedById).toBe(referrer.user.id);
    const stillPending = await prisma.pendingReferral.findUnique({ where: { telegramId: BigInt(telegramId) } });
    expect(stillPending).toBeNull();
  });

  it("registerPendingReferral doesn't attribute someone who already has an account", async () => {
    const referrer = await register('Referrer Existing');
    const existing = await register('Already Has Account');
    const existingTelegramId = BigInt(777_000_000_000 + Date.now());
    await prisma.user.update({ where: { id: existing.user.id }, data: { telegramId: existingTelegramId } });

    await auth.registerPendingReferral(referrer.user.referralCode, existingTelegramId);
    const pending = await prisma.pendingReferral.findUnique({ where: { telegramId: existingTelegramId } });
    expect(pending).toBeNull();
  });

  it('admin grants Premium for a fixed term, and it lazily expires on next read', async () => {
    const ownerEmail = `ref-owner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password: 'password123', displayName: 'Duration Owner' });
    await prisma.user.update({ where: { email: ownerEmail }, data: { role: 'OWNER' } });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: 'password123' });
    const ownerToken = ownerLogin.body.accessToken as string;

    const target = await register('Duration Target');

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${target.user.id}/premium`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isPremium: true, durationMonths: 3 })
      .expect(200);

    const afterGrant = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(afterGrant.isPremium).toBe(true);
    expect(afterGrant.premiumUntil).not.toBeNull();

    // Force it into the past to simulate three months passing, then read
    // the profile — the lazy check should clear it right there.
    await prisma.user.update({ where: { id: target.user.id }, data: { premiumUntil: new Date(Date.now() - 1000) } });
    const profile = await request(app.getHttpServer()).get(`/api/users/${target.user.id}`).expect(200);
    expect(profile.body.isPremium).toBe(false);

    const afterExpiry = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(afterExpiry.isPremium).toBe(false);
    expect(afterExpiry.premiumUntil).toBeNull();
  });

  it('admin "Навсегда" grant sets no expiry', async () => {
    const ownerEmail = `ref-owner2-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password: 'password123', displayName: 'Forever Owner' });
    await prisma.user.update({ where: { email: ownerEmail }, data: { role: 'OWNER' } });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: 'password123' });
    const ownerToken = ownerLogin.body.accessToken as string;

    const target = await register('Forever Target');
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${target.user.id}/premium`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isPremium: true })
      .expect(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(row.isPremium).toBe(true);
    expect(row.premiumUntil).toBeNull();
  });

  it('Shop purchase grants exactly one month, and a repeat purchase stacks instead of resetting', async () => {
    const player = await register('Shop Stacker');
    await prisma.user.update({ where: { id: player.user.id }, data: { zCoins: 22222 * 2 } });

    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${player.token}`)
      .expect(201);

    const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: player.user.id } });
    const firstUntil = afterFirst.premiumUntil!.getTime();
    const oneMonthMs = 27 * 24 * 60 * 60 * 1000; // conservative lower bound (28-31 day months)
    expect(firstUntil).toBeGreaterThan(Date.now() + oneMonthMs);

    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${player.token}`)
      .expect(201);

    const afterSecond = await prisma.user.findUniqueOrThrow({ where: { id: player.user.id } });
    const secondUntil = afterSecond.premiumUntil!.getTime();
    // Stacked from the first expiry, not from "now" — should be roughly another month past firstUntil.
    expect(secondUntil).toBeGreaterThan(firstUntil + oneMonthMs);
  });

  it('Shop purchase is blocked once Premium is permanent', async () => {
    const player = await register('Shop Blocked');
    await prisma.user.update({
      where: { id: player.user.id },
      data: { zCoins: 22222, isPremium: true, premiumUntil: null },
    });

    await request(app.getHttpServer())
      .post('/api/shop/premium')
      .set('Authorization', `Bearer ${player.token}`)
      .expect(409);
  });

  it('Shop free trial grants once and refuses a repeat', async () => {
    const player = await register('Shop Trial');

    const first = await request(app.getHttpServer())
      .post('/api/shop/trial')
      .set('Authorization', `Bearer ${player.token}`)
      .expect(201);
    expect(first.body.granted).toBe(true);

    const second = await request(app.getHttpServer())
      .post('/api/shop/trial')
      .set('Authorization', `Bearer ${player.token}`)
      .expect(201);
    expect(second.body.granted).toBe(false);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: player.user.id } });
    expect(row.usedTrialPremium).toBe(true);
    expect(row.nameStyle).toBe('GLOW');
  });

  it('Premium style self-service is gated by fresh Premium status, not a stale flag', async () => {
    const player = await register('Style Gate');
    await prisma.user.update({
      where: { id: player.user.id },
      data: { isPremium: true, premiumUntil: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .patch('/api/users/me/premium')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ nameStyle: 'GLOW', nameColor: '#ffffff', ringStyle: 'PULSE', badgeEmoji: null })
      .expect(403);
  });
});
