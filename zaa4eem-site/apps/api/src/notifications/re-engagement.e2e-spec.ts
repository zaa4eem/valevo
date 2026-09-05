import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  GIVE_UP_AFTER_MS,
  IDLE_BEFORE_WINBACK_MS,
  ReEngagementService,
  WINBACK_COOLDOWN_MS,
} from './re-engagement.service';

const canRun = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;

(canRun ? describe : describe.skip)('Win-back nudges (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ReEngagementService;
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(ReEngagementService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Created straight through Prisma so lastActiveAt can be backdated. */
  async function makeUser(displayName: string, idleForMs: number | null) {
    seq += 1;
    return prisma.user.create({
      data: {
        displayName,
        email: `winback-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        referralCode: `wb${Date.now().toString(36)}${seq}${Math.random().toString(36).slice(2, 6)}`,
        lastActiveAt: idleForMs === null ? null : new Date(Date.now() - idleForMs),
        // Everything reaches the bell regardless of these, but keeping them on
        // matches a default account.
        notifyPush: false,
        notifyTelegram: false,
      },
    });
  }

  /** Something for the summary to talk about — without it the sweep sends nothing on purpose. */
  async function makeSomethingHappen(author: { id: string }) {
    return prisma.post.create({
      data: { authorId: author.id, body: 'что-то произошло пока вас не было', publishedAt: new Date() },
    });
  }

  async function winbacksFor(userId: string) {
    return prisma.notification.count({ where: { userId, targetType: 'WINBACK' } });
  }

  it('nudges someone who has been away a week, and never twice inside the cooldown', async () => {
    const active = await makeUser('Активный автор', 0);
    await makeSomethingHappen(active);
    const lapsed = await makeUser('Ушедший', IDLE_BEFORE_WINBACK_MS + DAY);

    await service.sweep();
    expect(await winbacksFor(lapsed.id)).toBe(1);

    const nudge = await prisma.notification.findFirst({
      where: { userId: lapsed.id, targetType: 'WINBACK' },
    });
    expect(nudge?.body).toContain('Пока вас не было');

    // A second sweep the same day must stay silent.
    await service.sweep();
    expect(await winbacksFor(lapsed.id)).toBe(1);
  });

  it('leaves alone anyone still active, and anyone gone so long they have clearly left', async () => {
    const active = await makeUser('Заходит каждый день', DAY);
    const longGone = await makeUser('Давно ушёл', GIVE_UP_AFTER_MS + 10 * DAY);
    const never = await makeUser('Ни разу не заходил', null);
    await makeSomethingHappen(await makeUser('Кто-то пишет', 0));

    await service.sweep();

    expect(await winbacksFor(active.id)).toBe(0);
    expect(await winbacksFor(longGone.id)).toBe(0);
    expect(await winbacksFor(never.id)).toBe(0);
  });

  it('nudges again once the cooldown has passed', async () => {
    const lapsed = await makeUser('Возвращаемый', IDLE_BEFORE_WINBACK_MS + 2 * DAY);
    await makeSomethingHappen(await makeUser('Автор постов', 0));

    await service.sweep();
    expect(await winbacksFor(lapsed.id)).toBe(1);

    // Backdate the nudge past the cooldown; the next sweep may speak again.
    await prisma.notification.updateMany({
      where: { userId: lapsed.id, targetType: 'WINBACK' },
      data: { createdAt: new Date(Date.now() - WINBACK_COOLDOWN_MS - DAY) },
    });

    await service.sweep();
    expect(await winbacksFor(lapsed.id)).toBe(2);
  });

  it('the manual trigger is owner-only', async () => {
    await request(app.getHttpServer()).post('/api/notifications/win-back/run').expect(401);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `wb-plain-${Date.now()}@test.dev`,
        password: 'password123',
        displayName: 'Обычный',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/notifications/win-back/run')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(403);
  });
});
