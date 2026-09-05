import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Notifications (e2e)', () => {
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

  let userSeq = 0;

  /**
   * The display name is Cyrillic on purpose (the notification bodies quote it),
   * but the email local part has to stay ASCII — zod's `.email()` rejects
   * anything else, and a 400 here reads as a confusing "cannot read id of
   * undefined" further down.
   */
  async function register(label: string) {
    const local = `notif-${Date.now()}-${(userSeq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `${local}@test.dev`,
        password: 'password123',
        displayName: label,
      });
    if (!res.body?.user) {
      throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  }

  it('notifies a post author when someone likes it, and counts it as unread', async () => {
    const author = await register('Автор');
    const liker = await register('Лайкер');

    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ body: 'пост для лайка', publish: true })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/like`)
      .set('Authorization', `Bearer ${liker.token}`)
      .expect(201);

    // The like handler fires the notification without awaiting it, so give
    // that its own tick before reading the feed back.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const list = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);

    expect(list.body.unreadCount).toBeGreaterThanOrEqual(1);
    const liked = list.body.items.find((n: any) => n.type === 'POST_LIKED');
    expect(liked).toBeDefined();
    expect(liked.body).toContain('Лайкер');
    expect(liked.read).toBe(false);
    expect(liked.actor.id).toBe(liker.id);
  });

  it('notifies about a new follower', async () => {
    const followed = await register('Популярный');
    const follower = await register('Подписчик');

    await request(app.getHttpServer())
      .post(`/api/users/${followed.id}/follow`)
      .set('Authorization', `Bearer ${follower.token}`)
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const list = await request(app.getHttpServer())
      .get('/api/notifications?filter=social')
      .set('Authorization', `Bearer ${followed.token}`)
      .expect(200);

    expect(list.body.items.some((n: any) => n.type === 'NEW_FOLLOWER')).toBe(true);
  });

  it('never notifies someone about their own action', async () => {
    const user = await register('Сам');

    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ body: 'сам себе', publish: true })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/like`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const list = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(list.body.unreadCount).toBe(0);
  });

  it('marks everything read and drops the unread count to zero', async () => {
    const author = await register('Читатель');
    const liker = await register('Другой');

    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ body: 'ещё пост', publish: true })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/like`)
      .set('Authorization', `Bearer ${liker.token}`)
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const before = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);
    expect(before.body.unreadCount).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);
    expect(after.body.unreadCount).toBe(0);
  });

  it("cannot mark another user's notification as read", async () => {
    const owner = await register('Владелец уведомления');
    const stranger = await register('Посторонний');

    const notification = await prisma.notification.create({
      data: { userId: owner.id, type: 'SYSTEM', body: 'только для владельца' },
    });

    await request(app.getHttpServer())
      .post(`/api/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(200);

    // The endpoint answers for the caller's own feed, so the owner's entry
    // must be untouched — scoping the update by userId is what stops one
    // user clearing another's notifications by guessing an id.
    const still = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(still?.readAt).toBeNull();
  });

  it('respects a switched-off preference for the reach-out channels but still records the event', async () => {
    const author = await register('Тихий');
    const liker = await register('Шумный');

    await request(app.getHttpServer())
      .patch('/api/notifications/prefs')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ notifyLikes: false })
      .expect(200);

    const prefs = await request(app.getHttpServer())
      .get('/api/notifications/prefs')
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);
    expect(prefs.body.notifyLikes).toBe(false);
    expect(prefs.body.notifyComments).toBe(true);

    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ body: 'без уведомлений о лайках', publish: true })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/posts/${post.body.id}/like`)
      .set('Authorization', `Bearer ${liker.token}`)
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 300));

    // The bell always keeps the history — the switch only silences push and
    // Telegram, which is what "уведомления о лайках выключены" should mean.
    const list = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);
    expect(list.body.items.some((n: any) => n.type === 'POST_LIKED')).toBe(true);
  });

  it('stores and removes a browser push subscription', async () => {
    const user = await register('Подписчик пуша');
    const endpoint = `https://fcm.googleapis.com/fcm/send/${Math.random().toString(36).slice(2)}`;
    const subscription = { endpoint, keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' } };

    await request(app.getHttpServer())
      .post('/api/notifications/push/subscribe')
      .set('Authorization', `Bearer ${user.token}`)
      .send(subscription)
      .expect(204);

    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);

    // Re-subscribing with the same endpoint must not create a duplicate —
    // browsers hand back the same subscription on every visit.
    await request(app.getHttpServer())
      .post('/api/notifications/push/subscribe')
      .set('Authorization', `Bearer ${user.token}`)
      .send(subscription)
      .expect(204);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);

    await request(app.getHttpServer())
      .delete('/api/notifications/push/subscribe')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ endpoint })
      .expect(204);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });

  it('refuses an SSE connection without a valid ticket', async () => {
    await request(app.getHttpServer()).get('/api/notifications/stream').expect(401);
    await request(app.getHttpServer()).get('/api/notifications/stream?ticket=nonsense').expect(401);
  });

  it('will not accept a normal access token as a stream ticket', async () => {
    const user = await register('Билетчик');
    // The access token is signed with the same secret, so only the purpose
    // claim stops it being replayed here as a long-lived stream credential.
    await request(app.getHttpServer())
      .get(`/api/notifications/stream?ticket=${user.token}`)
      .expect(401);
  });
});
