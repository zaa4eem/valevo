import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Posts (e2e)', () => {
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

  it('non-owner cannot publish a post', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `sub-${Date.now()}@test.dev`, password: 'password123', displayName: 'Sub' });

    await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .send({ body: 'trying to post', publish: true })
      .expect(403);
  });

  it('owner can publish a post visible on the public feed', async () => {
    const email = `owner-${Date.now()}@test.dev`;
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Owner' });

    await prisma.user.update({ where: { email }, data: { role: 'OWNER' } });

    // Re-login to pick up a fresh token reflecting the OWNER role.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' });

    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ body: 'Первый пост zaa4eem', publish: true })
      .expect(201);

    const feed = await request(app.getHttpServer()).get('/api/posts').expect(200);
    expect(feed.body.some((post: any) => post.id === created.body.id)).toBe(true);
  });
});
