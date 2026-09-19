import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { SCROLLS_DIR } from './video-storage';

const run = promisify(execFile);
const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Scrolls (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tmpDir: string;
  let clipPath: string;
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // A real 2-second clip, made with ffmpeg itself. The whole point of
    // these tests is that the actual transcode pipeline runs — a stubbed
    // one would prove nothing about the part most likely to break.
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scrolls-e2e-'));
    clipPath = path.join(tmpDir, 'clip.mp4');
    await run('ffmpeg', [
      '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=15:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
      clipPath,
    ]);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  async function register(name: string) {
    seq += 1;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `scroll-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        password: 'password123',
        displayName: name,
      });
    if (!res.body?.user) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  }

  async function owner() {
    const user = await register('Модератор');
    await prisma.user.update({ where: { id: user.id }, data: { role: 'OWNER' } });
    // The role is baked into the access token, so it has to be re-minted.
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: (await prisma.user.findUnique({ where: { id: user.id } }))!.email, password: 'password123' });
    return { ...user, token: res.body.accessToken as string };
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Uploads and waits for the background transcode to land. */
  async function upload(token: string, caption = 'тестовый ролик') {
    const res = await request(app.getHttpServer())
      .post('/api/scrolls')
      .set(auth(token))
      .field('caption', caption)
      .attach('video', clipPath)
      .expect(201);
    expect(res.body.status).toBe('PROCESSING');

    for (let i = 0; i < 90; i += 1) {
      const row = await prisma.scroll.findUnique({ where: { id: res.body.id } });
      if (row && row.status !== 'PROCESSING') return row;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('transcode never finished');
  }

  it('transcodes an upload to a playable mp4 with a cover frame', async () => {
    const author = await register('Автор ролика');
    const row = await upload(author.token);

    expect(row.status).toBe('PENDING_REVIEW');
    expect(row.videoUrl).toMatch(/^\/uploads\/scrolls\/[\w-]+\.mp4$/);
    expect(row.posterUrl).toMatch(/^\/uploads\/scrolls\/[\w-]+\.jpg$/);
    // Read back off the encoded file, not copied from the source.
    expect(row.width).toBe(360);
    expect(row.height).toBe(640);
    expect(row.durationMs).toBeGreaterThan(1500);

    for (const url of [row.videoUrl, row.posterUrl]) {
      expect(fs.existsSync(path.join(SCROLLS_DIR, path.basename(url)))).toBe(true);
    }
  }, 120_000);

  it('never shows a clip in the feed before a human has approved it', async () => {
    const author = await register('Ожидающий');
    const row = await upload(author.token);

    const before = await request(app.getHttpServer()).get('/api/scrolls').expect(200);
    expect(before.body.items.some((s: any) => s.id === row.id)).toBe(false);

    const mod = await owner();
    await request(app.getHttpServer())
      .post(`/api/scrolls/moderation/${row.id}`)
      .set(auth(mod.token))
      .send({ approve: true })
      .expect(201);

    const after = await request(app.getHttpServer()).get('/api/scrolls').expect(200);
    expect(after.body.items.some((s: any) => s.id === row.id)).toBe(true);
  }, 120_000);

  it('keeps a rejected clip out of the feed and tells its author why', async () => {
    const author = await register('Отклонённый');
    const row = await upload(author.token);
    const mod = await owner();

    await request(app.getHttpServer())
      .post(`/api/scrolls/moderation/${row.id}`)
      .set(auth(mod.token))
      .send({ approve: false, reason: 'Не по теме' })
      .expect(201);

    const feed = await request(app.getHttpServer()).get('/api/scrolls').expect(200);
    expect(feed.body.items.some((s: any) => s.id === row.id)).toBe(false);

    // The author still sees it, with the reason — a rejected upload must
    // never just silently vanish.
    const mine = await request(app.getHttpServer()).get('/api/scrolls/mine').set(auth(author.token)).expect(200);
    const found = mine.body.find((s: any) => s.id === row.id);
    expect(found.status).toBe('REJECTED');
    expect(found.rejectionReason).toBe('Не по теме');

    await new Promise((resolve) => setTimeout(resolve, 400));
    const notes = await request(app.getHttpServer()).get('/api/notifications').set(auth(author.token)).expect(200);
    expect(notes.body.items.some((n: any) => n.body.includes('отклонён'))).toBe(true);
  }, 120_000);

  it('refuses to publish a clip that is still being transcoded', async () => {
    const author = await register('Быстрый');
    const mod = await owner();
    const res = await request(app.getHttpServer())
      .post('/api/scrolls')
      .set(auth(author.token))
      .field('caption', '')
      .attach('video', clipPath)
      .expect(201);

    // Straight away, while the row is still PROCESSING — approving here
    // would publish a clip with no file behind it.
    const review = await request(app.getHttpServer())
      .post(`/api/scrolls/moderation/${res.body.id}`)
      .set(auth(mod.token))
      .send({ approve: true });
    expect([400, 201]).toContain(review.status);
    if (review.status === 201) {
      // The transcode won the race; then it must at least have a file.
      const row = await prisma.scroll.findUnique({ where: { id: res.body.id } });
      expect(row?.videoUrl).not.toBe('');
    }
  }, 120_000);

  it('marks a file that is not really a video as failed instead of publishing it', async () => {
    const author = await register('Обманщик');
    const fake = path.join(tmpDir, 'fake.mp4');
    await fs.promises.writeFile(fake, 'это совсем не видео, просто текст');

    const res = await request(app.getHttpServer())
      .post('/api/scrolls')
      .set(auth(author.token))
      .field('caption', '')
      // The mimetype is a client claim; ffprobe is what actually decides.
      .attach('video', fake, { contentType: 'video/mp4' })
      .expect(201);

    let row = null;
    for (let i = 0; i < 40; i += 1) {
      row = await prisma.scroll.findUnique({ where: { id: res.body.id } });
      if (row && row.status !== 'PROCESSING') break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(row?.status).toBe('FAILED');
    expect(row?.rejectionReason).toBeTruthy();
  }, 120_000);

  it('rejects a file type that is not video at all', async () => {
    const author = await register('Не видео');
    const notVideo = path.join(tmpDir, 'note.txt');
    await fs.promises.writeFile(notVideo, 'hello');
    await request(app.getHttpServer())
      .post('/api/scrolls')
      .set(auth(author.token))
      .attach('video', notVideo, { contentType: 'text/plain' })
      .expect(400);
  });

  it('lets a viewer like, unlike and comment on a published clip', async () => {
    const author = await register('Автор популярного');
    const viewer = await register('Зритель');
    const mod = await owner();
    const row = await upload(author.token);
    await request(app.getHttpServer())
      .post(`/api/scrolls/moderation/${row.id}`)
      .set(auth(mod.token))
      .send({ approve: true })
      .expect(201);

    const liked = await request(app.getHttpServer())
      .post(`/api/scrolls/${row.id}/like`)
      .set(auth(viewer.token))
      .expect(201);
    expect(liked.body.likeCount).toBe(1);
    expect(liked.body.viewerHasLiked).toBe(true);

    // Liking twice is not two likes — the row is keyed on (clip, user).
    const again = await request(app.getHttpServer())
      .post(`/api/scrolls/${row.id}/like`)
      .set(auth(viewer.token))
      .expect(201);
    expect(again.body.likeCount).toBe(1);

    const unliked = await request(app.getHttpServer())
      .delete(`/api/scrolls/${row.id}/like`)
      .set(auth(viewer.token))
      .expect(200);
    expect(unliked.body.likeCount).toBe(0);

    const comments = await request(app.getHttpServer())
      .post(`/api/scrolls/${row.id}/comments`)
      .set(auth(viewer.token))
      .send({ body: 'огонь' })
      .expect(201);
    expect(comments.body[0].body).toBe('огонь');
    expect(comments.body[0].author.id).toBe(viewer.id);
  }, 120_000);

  it('will not let a stranger delete someone else’s clip', async () => {
    const author = await register('Владелец ролика');
    const stranger = await register('Чужой');
    const row = await upload(author.token);

    await request(app.getHttpServer())
      .delete(`/api/scrolls/${row.id}`)
      .set(auth(stranger.token))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/scrolls/${row.id}`)
      .set(auth(author.token))
      .expect(204);
    expect(await prisma.scroll.findUnique({ where: { id: row.id } })).toBeNull();
    // Deleting the row takes its files with it.
    expect(fs.existsSync(path.join(SCROLLS_DIR, path.basename(row.videoUrl)))).toBe(false);
  }, 120_000);

  it('keeps the moderation queue owner-only', async () => {
    const plain = await register('Обычный');
    await request(app.getHttpServer()).get('/api/scrolls/moderation/queue').expect(401);
    await request(app.getHttpServer())
      .get('/api/scrolls/moderation/queue')
      .set(auth(plain.token))
      .expect(403);
  });

  it('will not let an anonymous visitor upload', async () => {
    await request(app.getHttpServer()).post('/api/scrolls').attach('video', clipPath).expect(401);
  });
});
