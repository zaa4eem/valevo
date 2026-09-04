import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Search (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds a profile, a post, and an idea by a shared unique keyword', async () => {
    const unique = `zzzsearchmarker${Date.now()}`;
    const email = `${unique}@test.dev`;

    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: `User ${unique}` });
    const token = register.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: `post mentioning ${unique}`, publish: true })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/ideas')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: `Idea about ${unique}`, description: 'Enough characters to pass validation.' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/search?q=${unique}`)
      .expect(200);

    expect(res.body.users.some((u: any) => u.displayName.includes(unique))).toBe(true);
    expect(res.body.posts.some((p: any) => p.body.includes(unique))).toBe(true);
    expect(res.body.ideas.some((i: any) => i.title.includes(unique))).toBe(true);
  });

  it('rejects an empty query', async () => {
    await request(app.getHttpServer()).get('/api/search?q=').expect(400);
  });

  it('filters to one section via type, and returns nothing for the others', async () => {
    const unique = `zzztypefilter${Date.now()}`;
    const email = `${unique}@test.dev`;

    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: `User ${unique}` });
    const token = register.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: `post mentioning ${unique}`, publish: true })
      .expect(201);

    const usersOnly = await request(app.getHttpServer())
      .get(`/api/search?q=${unique}&type=users`)
      .expect(200);
    expect(usersOnly.body.users.some((u: any) => u.displayName.includes(unique))).toBe(true);
    expect(usersOnly.body.posts).toEqual([]);
    expect(usersOnly.body.ideas).toEqual([]);

    const postsOnly = await request(app.getHttpServer())
      .get(`/api/search?q=${unique}&type=posts`)
      .expect(200);
    expect(postsOnly.body.posts.some((p: any) => p.body.includes(unique))).toBe(true);
    expect(postsOnly.body.users).toEqual([]);
    expect(postsOnly.body.ideas).toEqual([]);
  });

  it('rejects an unknown type value', async () => {
    await request(app.getHttpServer()).get('/api/search?q=test&type=bogus').expect(400);
  });
});
