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

  it('lets a non-owner publish a post, then blocks a second one within 12h', async () => {
    const email = `sub-${Date.now()}@test.dev`;
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Sub' });

    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .send({ body: 'my first post', publish: true })
      .expect(201);

    const feed = await request(app.getHttpServer()).get('/api/posts').expect(200);
    expect(feed.body.items.some((post: any) => post.id === created.body.id)).toBe(true);

    await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .send({ body: 'trying again immediately', publish: true })
      .expect(403);
  });

  it('owner can publish repeatedly without the 12h cooldown', async () => {
    const email = `owner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
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
    expect(feed.body.items.some((post: any) => post.id === created.body.id)).toBe(true);

    await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ body: 'Второй пост подряд', publish: true })
      .expect(201);
  });

  it('lets a post author (not just the owner) like and comment on posts', async () => {
    const authorEmail = `postauthor-${Date.now()}@test.dev`;
    const author = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: authorEmail, password: 'password123', displayName: 'Post Author' });

    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .send({ body: 'like and comment me', publish: true })
      .expect(201);

    const liker = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `liker-${Date.now()}@test.dev`, password: 'password123', displayName: 'Liker' });

    await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/like`)
      .set('Authorization', `Bearer ${liker.body.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/like`)
      .set('Authorization', `Bearer ${liker.body.accessToken}`)
      .expect(409);

    const comment = await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${liker.body.accessToken}`)
      .send({ body: 'nice post!' })
      .expect(201);

    const comments = await request(app.getHttpServer())
      .get(`/api/posts/${post.body.id}/comments`)
      .expect(200);
    expect(comments.body.some((c: any) => c.id === comment.body.id)).toBe(true);

    const feed = await request(app.getHttpServer()).get('/api/posts').expect(200);
    const feedPost = feed.body.items.find((p: any) => p.id === post.body.id);
    expect(feedPost.likeCount).toBe(1);
    expect(feedPost.commentCount).toBe(1);
  });

  it('paginates the feed with a cursor', async () => {
    const email = `pager-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Pager' });
    await prisma.user.update({ where: { email }, data: { role: 'OWNER' } });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' });
    const token = login.body.accessToken as string;

    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const created = await request(app.getHttpServer())
        .post('/api/posts')
        .set('Authorization', `Bearer ${token}`)
        .send({ body: `paged post ${i}`, publish: true })
        .expect(201);
      ids.push(created.body.id);
    }

    const firstPage = await request(app.getHttpServer())
      .get('/api/posts?limit=2')
      .expect(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.nextCursor).not.toBeNull();
    const firstPageIds = firstPage.body.items.map((p: any) => p.id);
    expect(new Set(firstPageIds)).toEqual(new Set([ids[1], ids[2]]));

    const secondPage = await request(app.getHttpServer())
      .get(`/api/posts?limit=2&cursor=${firstPage.body.nextCursor}`)
      .expect(200);
    const secondPageIds = secondPage.body.items.map((p: any) => p.id);
    expect(secondPageIds).toContain(ids[0]);
    expect(secondPageIds.some((id: string) => firstPageIds.includes(id))).toBe(false);
  });
});
