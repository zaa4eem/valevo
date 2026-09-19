import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Discover (e2e)', () => {
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
        email: `disc-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        password: 'password123',
        displayName: name,
      });
    if (!res.body?.user) throw new Error(`register failed: ${res.status}`);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('gives a signed-out visitor something to look at', async () => {
    const res = await request(app.getHttpServer()).get('/api/discover').expect(200);
    // The whole point: the search screen must never be an empty shell.
    expect(Array.isArray(res.body.people)).toBe(true);
    expect(res.body.people.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.ideas)).toBe(true);
    expect(res.body.people[0].reason).toBeTruthy();
  });

  it('never suggests you, or anyone you already follow', async () => {
    const me = await register('Я сам');
    const followed = await register('Уже читаю');

    await request(app.getHttpServer())
      .post(`/api/users/${followed.id}/follow`)
      .set(auth(me.token))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/discover')
      .set(auth(me.token))
      .expect(200);

    const ids = res.body.people.map((p: any) => p.id);
    expect(ids).not.toContain(me.id);
    expect(ids).not.toContain(followed.id);
  });

  it('ranks a friend-of-a-friend above a merely popular account', async () => {
    const me = await register('Ищущий');
    const bridge = await register('Мост');
    const target = await register('Цель через друга');

    // me -> bridge -> target. target should surface because bridge follows them.
    await request(app.getHttpServer())
      .post(`/api/users/${bridge.id}/follow`)
      .set(auth(me.token))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/users/${target.id}/follow`)
      .set(auth(bridge.token))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/discover')
      .set(auth(me.token))
      .expect(200);

    const found = res.body.people.find((p: any) => p.id === target.id);
    expect(found).toBeDefined();
    // The reason has to explain itself — a list of names with no "why" reads as random.
    expect(found.reason).toContain('ваших');
  });

  it('suggests the author of a post you liked', async () => {
    const me = await register('Лайкер');
    const author = await register('Понравившийся автор');

    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(author.token))
      .send({ body: 'пост, который лайкнут', publish: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/like`)
      .set(auth(me.token))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/discover')
      .set(auth(me.token))
      .expect(200);

    const found = res.body.people.find((p: any) => p.id === author.id);
    expect(found).toBeDefined();
    expect(found.reason).toBe('Вы лайкали посты этого автора');
  });

  it('hides a banned account from suggestions', async () => {
    const me = await register('Смотрящий');
    const banned = await register('Забаненный');
    await prisma.user.update({ where: { id: banned.id }, data: { status: 'BANNED' } });

    const res = await request(app.getHttpServer())
      .get('/api/discover')
      .set(auth(me.token))
      .expect(200);
    expect(res.body.people.map((p: any) => p.id)).not.toContain(banned.id);
  });

  it('keeps unmoderated content out of what it shows a normal visitor', async () => {
    const author = await register('Автор на модерации');
    const post = await prisma.post.create({
      data: {
        authorId: author.id,
        body: 'ждёт проверки',
        publishedAt: new Date(),
        moderationState: 'PENDING_REVIEW',
      },
    });

    const res = await request(app.getHttpServer()).get('/api/discover').expect(200);
    expect(res.body.posts.map((p: any) => p.id)).not.toContain(post.id);
  });

  it('ranks a signal by its own strength, not by the order signals arrive in', async () => {
    // A popular account picked up "Популярный автор" from the catch-all
    // query; a friend-of-a-friend edge then has to overwrite that reason,
    // which is only true if the comparison is against the strongest single
    // signal rather than against the accumulated score.
    const me = await register('Смотрящий');
    const bridge = await register('Мостик');
    const target = await register('Цель рекомендации');

    // Make the target popular enough to be in the catch-all list first.
    for (let i = 0; i < 3; i += 1) {
      const fan = await register(`Фанат ${i}`);
      await request(app.getHttpServer())
        .post(`/api/users/${target.id}/follow`)
        .set(auth(fan.token))
        .expect(201);
    }
    await request(app.getHttpServer()).post(`/api/users/${bridge.id}/follow`).set(auth(me.token)).expect(201);
    await request(app.getHttpServer()).post(`/api/users/${target.id}/follow`).set(auth(bridge.token)).expect(201);

    const res = await request(app.getHttpServer()).get('/api/discover').set(auth(me.token)).expect(200);
    const suggestion = res.body.people.find((p: any) => p.id === target.id);
    expect(suggestion).toBeDefined();
    expect(suggestion.reason).not.toBe('Популярный автор');
    expect(suggestion.reason).toContain('ваших');
  });

  describe('similar profiles', () => {
    it("suggests who else a profile's followers read", async () => {
      const subject = await register('Тот, чей профиль открыли');
      const alsoRead = await register('Кого читают те же люди');
      const reader = await register('Общий читатель');

      await request(app.getHttpServer())
        .post(`/api/users/${subject.id}/follow`)
        .set(auth(reader.token))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/users/${alsoRead.id}/follow`)
        .set(auth(reader.token))
        .expect(201);

      // Signed out on purpose — this block is mostly for visitors.
      const res = await request(app.getHttpServer())
        .get(`/api/discover/similar/${subject.id}`)
        .expect(200);

      const ids = res.body.map((p: any) => p.id);
      expect(ids).toContain(alsoRead.id);
      // Never the profile being looked at.
      expect(ids).not.toContain(subject.id);
      const found = res.body.find((p: any) => p.id === alsoRead.id);
      expect(found.reason).toContain('общий читатель');
    });

    it('leaves out the viewer and the people the viewer already follows', async () => {
      const subject = await register('Профиль-повод');
      const alreadyFollowed = await register('Уже в подписках');
      const reader = await register('Читатель обоих');
      const viewer = await register('Гость профиля');

      await request(app.getHttpServer())
        .post(`/api/users/${subject.id}/follow`)
        .set(auth(reader.token))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/users/${alreadyFollowed.id}/follow`)
        .set(auth(reader.token))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/users/${viewer.id}/follow`)
        .set(auth(reader.token))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/users/${alreadyFollowed.id}/follow`)
        .set(auth(viewer.token))
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/discover/similar/${subject.id}`)
        .set(auth(viewer.token))
        .expect(200);

      const ids = res.body.map((p: any) => p.id);
      expect(ids).not.toContain(viewer.id);
      expect(ids).not.toContain(alreadyFollowed.id);
    });

    it('answers with an empty list for a profile nobody follows yet', async () => {
      const lonely = await register('Совсем новый');
      const res = await request(app.getHttpServer())
        .get(`/api/discover/similar/${lonely.id}`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('rejects an id that is not a uuid instead of scanning for it', async () => {
      await request(app.getHttpServer()).get('/api/discover/similar/not-a-uuid').expect(400);
    });
  });

  it('publishes level and streak on the public profile', async () => {
    // Registering already awards XP, so this is a real value, not a default.
    const user = await register('Профиль с уровнем');
    const res = await request(app.getHttpServer()).get(`/api/users/${user.id}`).expect(200);
    expect(typeof res.body.level).toBe('number');
    expect(res.body.level).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.streakDays).toBe('number');
    expect(res.body.streakDays).toBeGreaterThanOrEqual(0);
  });
});
