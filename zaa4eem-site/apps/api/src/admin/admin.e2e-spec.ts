import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Admin (e2e)', () => {
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

  it('blocks a non-owner from GET /admin/stats', async () => {
    const email = `sub-${Date.now()}@test.dev`;
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Subscriber' });

    await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .expect(403);
  });

  it('returns full stats with the new chart series for an owner', async () => {
    const email = `owner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Owner' });

    await prisma.user.update({ where: { email }, data: { role: 'OWNER' } });

    // Re-login to pick up a fresh token reflecting the OWNER role.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' });

    const res = await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(typeof res.body.totalUsers).toBe('number');
    expect(typeof res.body.ideasPendingModeration).toBe('number');
    expect(typeof res.body.totalGamePlays).toBe('number');
    expect(typeof res.body.ideasByStatus).toBe('object');

    // 30 days of zero-filled daily buckets for both time series.
    expect(Array.isArray(res.body.userGrowth)).toBe(true);
    expect(res.body.userGrowth.length).toBe(30);
    for (const day of res.body.userGrowth) {
      expect(typeof day.date).toBe('string');
      expect(typeof day.count).toBe('number');
    }

    expect(Array.isArray(res.body.activity)).toBe(true);
    expect(res.body.activity.length).toBe(30);
    for (const day of res.body.activity) {
      expect(typeof day.date).toBe('string');
      expect(typeof day.posts).toBe('number');
      expect(typeof day.ideas).toBe('number');
      expect(typeof day.scores).toBe('number');
    }

    // The account we just registered today should show up in today's bucket.
    const todayCount = res.body.userGrowth[res.body.userGrowth.length - 1].count;
    expect(todayCount).toBeGreaterThanOrEqual(1);
  });

  it('grants and revokes Premium, owner-only', async () => {
    const ownerEmail = `premowner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password: 'password123', displayName: 'Prem Owner' });
    await prisma.user.update({ where: { email: ownerEmail }, data: { role: 'OWNER' } });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: 'password123' });
    const ownerToken = ownerLogin.body.accessToken as string;

    const target = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `premtarget-${Date.now()}@test.dev`, password: 'password123', displayName: 'Prem Target' });
    const targetToken = target.body.accessToken as string;
    const targetId = target.body.user.id as string;

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${targetId}/premium`)
      .set('Authorization', `Bearer ${targetToken}`)
      .send({ isPremium: true, nameStyle: 'GLOW', nameColor: '#ff00aa', ringStyle: 'SPIN', badgeEmoji: '👑' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${targetId}/premium`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isPremium: true, nameStyle: 'GLOW', nameColor: '#ff00aa', ringStyle: 'SPIN', badgeEmoji: '👑' })
      .expect(200);

    const profileAfterGrant = await request(app.getHttpServer())
      .get(`/api/users/${targetId}`)
      .expect(200);
    expect(profileAfterGrant.body.isPremium).toBe(true);
    expect(profileAfterGrant.body.nameStyle).toBe('GLOW');
    expect(profileAfterGrant.body.nameColor).toBe('#ff00aa');
    expect(profileAfterGrant.body.ringStyle).toBe('SPIN');
    expect(profileAfterGrant.body.badgeEmoji).toBe('👑');

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${targetId}/premium`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isPremium: false })
      .expect(200);

    const profileAfterRevoke = await request(app.getHttpServer())
      .get(`/api/users/${targetId}`)
      .expect(200);
    expect(profileAfterRevoke.body.isPremium).toBe(false);
    expect(profileAfterRevoke.body.nameStyle).toBeNull();
    expect(profileAfterRevoke.body.badgeEmoji).toBeNull();
  });

  it('rejects an invalid Premium name color', async () => {
    const ownerEmail = `premowner2-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password: 'password123', displayName: 'Prem Owner 2' });
    await prisma.user.update({ where: { email: ownerEmail }, data: { role: 'OWNER' } });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: 'password123' });

    const target = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `premtarget2-${Date.now()}@test.dev`, password: 'password123', displayName: 'Prem Target 2' });

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${target.body.user.id}/premium`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ isPremium: true, nameStyle: 'GLOW', nameColor: 'not-a-color' })
      .expect(400);
  });
});
