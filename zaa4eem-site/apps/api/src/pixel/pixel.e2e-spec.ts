import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  PIXEL_CANVAS_SIZE,
  PIXEL_CELL_COUNT,
  PIXEL_COOLDOWN_MS,
  PIXEL_COOLDOWN_PREMIUM_MS,
} from '@zaa4eem/shared';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Pixel Battle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(name: string) {
    seq += 1;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `px-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        password: 'password123',
        displayName: name,
      });
    if (!res.body?.user) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A free cell, so parallel test runs never fight over the same coordinates. */
  let nextX = 0;
  function freeCell() {
    nextX += 1;
    return { x: nextX % PIXEL_CANVAS_SIZE, y: Math.floor(nextX / PIXEL_CANVAS_SIZE) + 100 };
  }

  it('serves the canvas as one byte per cell', async () => {
    const res = await request(app.getHttpServer()).get('/api/pixel/snapshot').expect(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    // Fixed length regardless of how much is painted — the client indexes
    // straight into it, so a short buffer would silently shift the canvas.
    expect(res.body.length).toBe(PIXEL_CELL_COUNT);
  });

  it('places a pixel and shows it in the snapshot at the right offset', async () => {
    const painter = await register('Художник');
    const { x, y } = freeCell();

    await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(painter.token))
      .send({ x, y, color: 9 })
      .expect(201);

    const snap = await request(app.getHttpServer()).get('/api/pixel/snapshot').expect(200);
    expect(snap.body[y * PIXEL_CANVAS_SIZE + x]).toBe(9);
  });

  it('refuses a second pixel before the cooldown is up, and says how long is left', async () => {
    const painter = await register('Нетерпеливый');
    const first = freeCell();
    const second = freeCell();

    await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(painter.token))
      .send({ ...first, color: 5 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(painter.token))
      .send({ ...second, color: 5 })
      .expect(400);
    // Retry-After carries the countdown; the body carries the sentence a
    // person reads. Both have to be right — a rejection with no "через
    // сколько" is the one thing more annoying than the wait itself.
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(PIXEL_COOLDOWN_MS / 1000);
    expect(res.body.message).toMatch(/через \d+ (сек|мин)/);

    // And the refused pixel really was not placed.
    const snap = await request(app.getHttpServer()).get('/api/pixel/snapshot').expect(200);
    expect(snap.body[second.y * PIXEL_CANVAS_SIZE + second.x]).toBe(0);
  });

  it('lets Premium paint again sooner', async () => {
    const painter = await register('Премиум-художник');
    await prisma.user.update({ where: { id: painter.id }, data: { isPremium: true, premiumUntil: null } });

    const state = await request(app.getHttpServer())
      .get('/api/pixel/state')
      .set(auth(painter.token))
      .expect(200);
    expect(state.body.cooldownMs).toBe(PIXEL_COOLDOWN_PREMIUM_MS);

    const cell = freeCell();
    await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(painter.token))
      .send({ ...cell, color: 7 })
      .expect(201);

    // Backdated past the Premium cooldown but not past the normal one: the
    // difference between the two is exactly what this asserts.
    await prisma.pixelPlacement.updateMany({
      where: { userId: painter.id },
      data: { createdAt: new Date(Date.now() - PIXEL_COOLDOWN_PREMIUM_MS - 1000) },
    });

    const again = freeCell();
    await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(painter.token))
      .send({ ...again, color: 7 })
      .expect(201);
  });

  it('does not give the Premium cooldown to an expired grant', async () => {
    const painter = await register('Бывший премиум');
    await prisma.user.update({
      where: { id: painter.id },
      data: { isPremium: true, premiumUntil: new Date(Date.now() - 60_000) },
    });

    const state = await request(app.getHttpServer())
      .get('/api/pixel/state')
      .set(auth(painter.token))
      .expect(200);
    expect(state.body.cooldownMs).toBe(PIXEL_COOLDOWN_MS);
  });

  it('rejects coordinates outside the canvas and colours outside the palette', async () => {
    const painter = await register('Мимо холста');
    for (const body of [
      { x: -1, y: 0, color: 3 },
      { x: PIXEL_CANVAS_SIZE, y: 0, color: 3 },
      { x: 0, y: PIXEL_CANVAS_SIZE, color: 3 },
      // 0 is the empty colour — paintable only by never having been painted,
      // never by choice, or one person could erase another's drawing.
      { x: 0, y: 0, color: 0 },
      { x: 0, y: 0, color: 999 },
    ]) {
      await request(app.getHttpServer()).post('/api/pixel').set(auth(painter.token)).send(body).expect(400);
    }
  });

  it('will not let an anonymous visitor paint, but will let them look', async () => {
    await request(app.getHttpServer()).post('/api/pixel').send({ x: 1, y: 1, color: 3 }).expect(401);
    const state = await request(app.getHttpServer()).get('/api/pixel/state').expect(200);
    expect(state.body.size).toBe(PIXEL_CANVAS_SIZE);
    // No account, no cooldown to report — not "you must wait".
    expect(state.body.cooldownRemainingMs).toBe(0);
  });

  it('keeps a cell history with who painted it, newest first', async () => {
    const first = await register('Первый слой');
    const second = await register('Второй слой');
    const { x, y } = freeCell();

    await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(first.token))
      .send({ x, y, color: 4 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(second.token))
      .send({ x, y, color: 11 })
      .expect(201);

    const res = await request(app.getHttpServer()).get(`/api/pixel/cell/${x}/${y}`).expect(200);
    expect(res.body.color).toBe(11);
    expect(res.body.history[0].user.id).toBe(second.id);
    expect(res.body.history[0].color).toBe(11);
    // The overwritten pixel is still in the history — that is the whole
    // point of keeping a log next to the canvas.
    expect(res.body.history[1].user.id).toBe(first.id);
    expect(res.body.history[1].color).toBe(4);
  });

  it('reports an empty cell rather than 404 for a spot nobody has painted', async () => {
    const res = await request(app.getHttpServer()).get('/api/pixel/cell/249/249').expect(200);
    expect(res.body.color).toBe(0);
    expect(res.body.history).toEqual([]);
  });

  it('counts a placement towards level progress', async () => {
    const painter = await register('Растущий');
    const before = await prisma.userProgress.findUnique({ where: { userId: painter.id } });
    const cell = freeCell();

    await request(app.getHttpServer())
      .post('/api/pixel')
      .set(auth(painter.token))
      .send({ ...cell, color: 6 })
      .expect(201);

    // The XP award is fired without awaiting so the pixel lands immediately.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const after = await prisma.userProgress.findUnique({ where: { userId: painter.id } });
    expect(after?.pixelsPainted ?? 0).toBe((before?.pixelsPainted ?? 0) + 1);
    expect(after?.xp ?? 0).toBeGreaterThan(before?.xp ?? 0);
  });
});
