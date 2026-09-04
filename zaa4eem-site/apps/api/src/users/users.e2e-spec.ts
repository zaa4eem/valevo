import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Users (e2e)', () => {
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

  it('exposes a public profile with derived stats', async () => {
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `profile-${Date.now()}@test.dev`, password: 'password123', displayName: 'Profile Test' });

    const me = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .expect(200);

    const publicView = await request(app.getHttpServer())
      .get(`/api/users/${me.body.id}`)
      .expect(200);

    expect(publicView.body.displayName).toBe('Profile Test');
    expect(publicView.body.stats.ideasSubmittedCount).toBe(0);
  });

  it('rejects a bio that fails the content filter', async () => {
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `bio-${Date.now()}@test.dev`, password: 'password123', displayName: 'Bio Test' });

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .send({ bio: 'ты полный мудак' })
      .expect(400);
  });

  it('lets a Premium user pick their own style, but not a non-Premium user', async () => {
    const nonPremium = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `notprem-${Date.now()}@test.dev`, password: 'password123', displayName: 'Not Premium' });

    // Not Premium yet — self-service is forbidden regardless of payload validity.
    await request(app.getHttpServer())
      .patch('/api/users/me/premium')
      .set('Authorization', `Bearer ${nonPremium.body.accessToken}`)
      .send({ nameStyle: 'FLOW', nameColor: null, ringStyle: 'SPIN', nameFont: null, badgeEmoji: '🔥' })
      .expect(403);

    await request(app.getHttpServer()).patch('/api/users/me/premium').send({}).expect(401);

    // Owner grants Premium (a blank style, same as AdminService.setPremium's default) ...
    const ownerEmail = `premstyleowner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password: 'password123', displayName: 'Prem Style Owner' });
    await prisma.user.update({ where: { email: ownerEmail }, data: { role: 'OWNER' } });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: 'password123' });

    const target = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `premstyletarget-${Date.now()}@test.dev`, password: 'password123', displayName: 'Prem Style Target' });
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${target.body.user.id}/premium`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ isPremium: true })
      .expect(200);

    // ... now the target picks their own look, without any admin involvement.
    const restyled = await request(app.getHttpServer())
      .patch('/api/users/me/premium')
      .set('Authorization', `Bearer ${target.body.accessToken}`)
      .send({ nameStyle: 'HOLO', nameColor: null, ringStyle: 'PULSE', nameFont: 'SPACE', badgeEmoji: '✨' })
      .expect(200);
    expect(restyled.body.nameStyle).toBe('HOLO');
    expect(restyled.body.ringStyle).toBe('PULSE');
    expect(restyled.body.nameFont).toBe('SPACE');
    expect(restyled.body.badgeEmoji).toBe('✨');

    // Same validation as the owner's admin endpoint applies here too.
    await request(app.getHttpServer())
      .patch('/api/users/me/premium')
      .set('Authorization', `Bearer ${target.body.accessToken}`)
      .send({ nameStyle: 'GLOW', nameColor: 'not-a-color', ringStyle: null, nameFont: null, badgeEmoji: null })
      .expect(400);
  });

  async function registerUser(email: string, displayName: string) {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName });
    return res.body as { accessToken: string; user: { id: string } };
  }

  it('lets a user follow and unfollow another user, updating counts', async () => {
    const author = await registerUser(`followed-${Date.now()}@test.dev`, 'Followed');
    const follower = await registerUser(`follower-${Date.now()}@test.dev`, 'Follower');

    await request(app.getHttpServer())
      .post(`/api/users/${author.user.id}/follow`)
      .set('Authorization', `Bearer ${follower.accessToken}`)
      .expect(201);

    const profileAsFollower = await request(app.getHttpServer())
      .get(`/api/users/${author.user.id}`)
      .set('Authorization', `Bearer ${follower.accessToken}`)
      .expect(200);
    expect(profileAsFollower.body.followerCount).toBe(1);
    expect(profileAsFollower.body.viewerIsFollowing).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/users/${author.user.id}/follow`)
      .set('Authorization', `Bearer ${follower.accessToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/api/users/${author.user.id}/follow`)
      .set('Authorization', `Bearer ${follower.accessToken}`)
      .expect(200);

    const profileAfterUnfollow = await request(app.getHttpServer())
      .get(`/api/users/${author.user.id}`)
      .expect(200);
    expect(profileAfterUnfollow.body.followerCount).toBe(0);
    expect(profileAfterUnfollow.body.viewerIsFollowing).toBeUndefined();
  });

  it('rejects following yourself', async () => {
    const user = await registerUser(`self-${Date.now()}@test.dev`, 'Self');

    await request(app.getHttpServer())
      .post(`/api/users/${user.user.id}/follow`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(403);
  });

  it('lists followers and following', async () => {
    const target = await registerUser(`target-${Date.now()}@test.dev`, 'Target');
    const followerA = await registerUser(`fa-${Date.now()}@test.dev`, 'Follower A');
    const followerB = await registerUser(`fb-${Date.now()}@test.dev`, 'Follower B');

    for (const follower of [followerA, followerB]) {
      await request(app.getHttpServer())
        .post(`/api/users/${target.user.id}/follow`)
        .set('Authorization', `Bearer ${follower.accessToken}`)
        .expect(201);
    }

    const followers = await request(app.getHttpServer())
      .get(`/api/users/${target.user.id}/followers`)
      .expect(200);
    const followerIds = followers.body.items.map((u: any) => u.id);
    expect(followerIds).toContain(followerA.user.id);
    expect(followerIds).toContain(followerB.user.id);

    const following = await request(app.getHttpServer())
      .get(`/api/users/${followerA.user.id}/following`)
      .expect(200);
    expect(following.body.items.map((u: any) => u.id)).toContain(target.user.id);
  });
});
