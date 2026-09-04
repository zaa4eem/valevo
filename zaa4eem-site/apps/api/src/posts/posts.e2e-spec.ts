import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
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
    app.useGlobalFilters(new HttpExceptionFilter());
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

    // Fake telegramId so like/comment actually attempt a Telegram DM against
    // the sandbox's placeholder bot token — the request must still succeed
    // even though that call is guaranteed to fail (notifications are
    // fire-and-forget and must never break the action that triggered them).
    await prisma.user.update({ where: { email: authorEmail }, data: { telegramId: BigInt(Date.now()) } });

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

  it('marks author.viewerIsFollowing in one batched query, not one per post', async () => {
    const author = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `followed-${Date.now()}@test.dev`, password: 'password123', displayName: 'Followed Author' });

    const follower = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `follower-${Date.now()}@test.dev`, password: 'password123', displayName: 'Follower' });

    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .send({ body: 'post from someone the viewer follows', publish: true })
      .expect(201);

    const beforeFollow = await request(app.getHttpServer())
      .get('/api/posts?limit=1')
      .set('Authorization', `Bearer ${follower.body.accessToken}`)
      .expect(200);
    expect(beforeFollow.body.items[0].author.viewerIsFollowing).toBe(false);

    await request(app.getHttpServer())
      .post(`/api/users/${author.body.user.id}/follow`)
      .set('Authorization', `Bearer ${follower.body.accessToken}`)
      .expect(201);

    const afterFollow = await request(app.getHttpServer())
      .get('/api/posts?limit=1')
      .set('Authorization', `Bearer ${follower.body.accessToken}`)
      .expect(200);
    expect(afterFollow.body.items[0].id).toBe(post.body.id);
    expect(afterFollow.body.items[0].author.viewerIsFollowing).toBe(true);
  });

  it('forces PENDING_REVIEW on a post with an image even when the caption text is completely clean', async () => {
    const email = `imageposter-${Date.now()}@test.dev`;
    const author = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Image Poster' });

    // The banned-words classifier only ever reads text, so this caption on
    // its own would classify CLEAN — the image attachment must override that.
    const upload = await request(app.getHttpServer())
      .post('/api/posts/me/image')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .attach('image', Buffer.from(TINY_PNG_BASE64, 'base64'), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(upload.body.imageUrl).toEqual(expect.stringContaining('/uploads/post-images/'));

    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .send({ body: 'совершенно чистая подпись', publish: true, imageUrl: upload.body.imageUrl })
      .expect(201);
    expect(created.body.imageUrl).toBe(upload.body.imageUrl);
    expect(created.body.moderationState).toBe('PENDING_REVIEW');

    // The pending image post stays visible to its own author in their own
    // feed (the own-post-visibility fix) ...
    const ownFeed = await request(app.getHttpServer())
      .get('/api/posts')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .expect(200);
    const ownFeedPost = ownFeed.body.items.find((p: any) => p.id === created.body.id);
    expect(ownFeedPost).toBeDefined();
    expect(ownFeedPost.moderationState).toBe('PENDING_REVIEW');

    // ... but not to a different, unrelated non-owner viewer, nor anonymously.
    const other = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `otherviewer-${Date.now()}@test.dev`, password: 'password123', displayName: 'Other Viewer' });
    const otherFeed = await request(app.getHttpServer())
      .get('/api/posts')
      .set('Authorization', `Bearer ${other.body.accessToken}`)
      .expect(200);
    expect(otherFeed.body.items.some((p: any) => p.id === created.body.id)).toBe(false);

    const anonFeed = await request(app.getHttpServer()).get('/api/posts').expect(200);
    expect(anonFeed.body.items.some((p: any) => p.id === created.body.id)).toBe(false);
  });

  it('rejects an unsupported file type on the post-image upload endpoint', async () => {
    const email = `badupload-${Date.now()}@test.dev`;
    const author = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Bad Upload' });

    await request(app.getHttpServer())
      .post('/api/posts/me/image')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .attach('image', Buffer.from('not an image'), { filename: 'note.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('lets the owner approve a pending image post, surfacing it in the moderation queue and then the public feed', async () => {
    const authorEmail = `pendingimg-${Date.now()}@test.dev`;
    const author = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: authorEmail, password: 'password123', displayName: 'Pending Poster' });

    const upload = await request(app.getHttpServer())
      .post('/api/posts/me/image')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .attach('image', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .send({ body: 'ждёт проверки', publish: true, imageUrl: upload.body.imageUrl })
      .expect(201);
    expect(created.body.moderationState).toBe('PENDING_REVIEW');

    const ownerEmail = `modowner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password: 'password123', displayName: 'Mod Owner' });
    await prisma.user.update({ where: { email: ownerEmail }, data: { role: 'OWNER' } });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: 'password123' });
    const ownerToken = ownerLogin.body.accessToken as string;

    const queue = await request(app.getHttpServer())
      .get('/api/admin/moderation-queue')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(queue.body.posts.some((p: any) => p.id === created.body.id)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/api/posts/${created.body.id}/moderation`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ moderationState: 'APPROVED' })
      .expect(200);

    const anonFeed = await request(app.getHttpServer()).get('/api/posts').expect(200);
    const approved = anonFeed.body.items.find((p: any) => p.id === created.body.id);
    expect(approved).toBeDefined();
    expect(approved.moderationState).toBe('APPROVED');

    const queueAfter = await request(app.getHttpServer())
      .get('/api/admin/moderation-queue')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(queueAfter.body.posts.some((p: any) => p.id === created.body.id)).toBe(false);
  });

  it('rejects a non-owner trying to moderate a post', async () => {
    const authorEmail = `pendingimg2-${Date.now()}@test.dev`;
    const author = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: authorEmail, password: 'password123', displayName: 'Pending Poster Two' });

    const upload = await request(app.getHttpServer())
      .post('/api/posts/me/image')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .attach('image', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .send({ body: 'ждёт проверки', publish: true, imageUrl: upload.body.imageUrl })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/posts/${created.body.id}/moderation`)
      .set('Authorization', `Bearer ${author.body.accessToken}`)
      .send({ moderationState: 'APPROVED' })
      .expect(403);
  });
});

// A minimal valid 1x1 transparent PNG, used to exercise the real multer
// fileFilter/diskStorage pipeline rather than faking a mimetype.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
