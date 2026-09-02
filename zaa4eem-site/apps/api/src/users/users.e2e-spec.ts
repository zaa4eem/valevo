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
});
