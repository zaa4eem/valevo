import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Users (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
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
});
