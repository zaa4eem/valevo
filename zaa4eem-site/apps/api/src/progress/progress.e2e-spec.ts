import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_COUNTERS,
  ONBOARDING_STEPS,
  REFERRAL_GOALS,
  XP_BY_EVENT,
  levelFromXp,
  questsForDay,
  seasonAt,
  streakMultiplier,
  xpForLevel,
} from '@zaa4eem/shared';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService, utcDay } from './progress.service';

const canRun = Boolean(process.env.DATABASE_URL);
const DAY_MS = 24 * 60 * 60 * 1000;

(canRun ? describe : describe.skip)('Progress (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let progress: ProgressService;
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    progress = app.get(ProgressService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(displayName: string) {
    seq += 1;
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `prog-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        password: 'password123',
        displayName,
      });
    if (!res.body?.user) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('XP and levels', () => {
    it('pays XP for publishing and reflects it in the level bar', async () => {
      const user = await register('Прогрессист');

      const before = await request(app.getHttpServer())
        .get('/api/progress')
        .set(auth(user.token))
        .expect(200);
      // Registering hasn't earned anything yet — the very first tracked
      // action is what starts the streak too.
      expect(before.body.level.level).toBe(1);

      await request(app.getHttpServer())
        .post('/api/posts')
        .set(auth(user.token))
        .send({ body: 'пост за опыт', publish: true })
        .expect(201);
      await new Promise((r) => setTimeout(r, 400));

      const after = await request(app.getHttpServer())
        .get('/api/progress')
        .set(auth(user.token))
        .expect(200);

      // The post, plus the day's check-in that any first action triggers,
      // plus the "Первое слово" achievement's own bonus.
      expect(after.body.level.xp).toBeGreaterThanOrEqual(
        XP_BY_EVENT.POST_PUBLISHED + XP_BY_EVENT.DAILY_CHECKIN,
      );
      expect(after.body.level.xpForNextLevel).toBeGreaterThan(0);
      expect(after.body.level.fraction).toBeGreaterThan(0);
    });

    it('agrees with the shared level curve', () => {
      expect(levelFromXp(0)).toBe(1);
      expect(levelFromXp(xpForLevel(2))).toBe(2);
      expect(levelFromXp(xpForLevel(2) - 1)).toBe(1);
      expect(levelFromXp(xpForLevel(10))).toBe(10);
      expect(levelFromXp(xpForLevel(10) - 1)).toBe(9);
    });
  });

  describe('streak', () => {
    it('counts a day once no matter how many actions happen in it', async () => {
      const user = await register('Стрикер');

      await progress.record(user.id, 'LIKE_GIVEN');
      await progress.record(user.id, 'LIKE_GIVEN');
      await progress.record(user.id, 'LIKE_GIVEN');

      const row = await prisma.userProgress.findUniqueOrThrow({ where: { userId: user.id } });
      expect(row.streakDays).toBe(1);
      expect(row.daysActive).toBe(1);
    });

    it('extends across consecutive days and resets after a gap', async () => {
      const user = await register('Ежедневный');
      await progress.touchStreak(user.id);

      // Yesterday → today extends.
      await prisma.userProgress.update({
        where: { userId: user.id },
        data: { lastStreakDay: new Date(utcDay().getTime() - DAY_MS) },
      });
      await progress.touchStreak(user.id);
      let row = await prisma.userProgress.findUniqueOrThrow({ where: { userId: user.id } });
      expect(row.streakDays).toBe(2);

      // A three-day hole resets to 1, and the best is remembered.
      await prisma.userProgress.update({
        where: { userId: user.id },
        data: { lastStreakDay: new Date(utcDay().getTime() - 3 * DAY_MS) },
      });
      await progress.touchStreak(user.id);
      row = await prisma.userProgress.findUniqueOrThrow({ where: { userId: user.id } });
      expect(row.streakDays).toBe(1);
      expect(row.streakBest).toBe(2);
    });

    it('forgives exactly one missed day for Premium, and only for Premium', async () => {
      const plain = await register('Без премиума');
      const premium = await register('С премиумом');
      await prisma.user.update({ where: { id: premium.id }, data: { isPremium: true } });

      for (const user of [plain, premium]) {
        await progress.touchStreak(user.id);
        await prisma.userProgress.update({
          where: { userId: user.id },
          data: { streakDays: 5, lastStreakDay: new Date(utcDay().getTime() - 2 * DAY_MS) },
        });
        await progress.touchStreak(user.id);
      }

      const plainRow = await prisma.userProgress.findUniqueOrThrow({ where: { userId: plain.id } });
      const premiumRow = await prisma.userProgress.findUniqueOrThrow({ where: { userId: premium.id } });
      expect(plainRow.streakDays).toBe(1);
      expect(premiumRow.streakDays).toBe(6);
      expect(premiumRow.freezeUsedAt).not.toBeNull();
    });

    it('will not freeze twice inside the cooldown', async () => {
      const user = await register('Заморозчик');
      await prisma.user.update({ where: { id: user.id }, data: { isPremium: true } });
      await progress.touchStreak(user.id);

      // First freeze: allowed.
      await prisma.userProgress.update({
        where: { userId: user.id },
        data: { streakDays: 4, lastStreakDay: new Date(utcDay().getTime() - 2 * DAY_MS) },
      });
      await progress.touchStreak(user.id);
      expect((await prisma.userProgress.findUniqueOrThrow({ where: { userId: user.id } })).streakDays).toBe(5);

      // Second freeze a day later: refused, streak resets.
      await prisma.userProgress.update({
        where: { userId: user.id },
        data: { lastStreakDay: new Date(utcDay().getTime() - 2 * DAY_MS) },
      });
      await progress.touchStreak(user.id);
      expect((await prisma.userProgress.findUniqueOrThrow({ where: { userId: user.id } })).streakDays).toBe(1);
    });

    it('raises the clicker multiplier and its daily cap', async () => {
      const user = await register('Кликер-стрик');
      await progress.touchStreak(user.id);
      await prisma.userProgress.update({ where: { userId: user.id }, data: { streakDays: 6 } });

      const state = await request(app.getHttpServer())
        .get('/api/clicker/state')
        .set(auth(user.token))
        .expect(200);

      expect(state.body.streakDays).toBe(6);
      expect(state.body.streakMultiplier).toBe(streakMultiplier(6));
      expect(state.body.dailyCap).toBeGreaterThan(2000);
    });
  });

  describe('daily quests', () => {
    it('gives the same three quests all day and pays out exactly once', async () => {
      const user = await register('Квестовик');
      const day = utcDay().toISOString().slice(0, 10);
      const mine = questsForDay(user.id, day);
      expect(mine).toHaveLength(3);
      // Stable: asking again must not reshuffle.
      expect(questsForDay(user.id, day).map((q) => q.code)).toEqual(mine.map((q) => q.code));

      const quest = mine[0];
      // Fast-forward the quest to done without replaying its action.
      await progress.ensureRow(user.id);
      await prisma.dailyQuestProgress.create({
        data: { userId: user.id, day: utcDay(), code: quest.code, progress: quest.target },
      });

      const coinsBefore = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).zCoins;

      const claim = await request(app.getHttpServer())
        .post(`/api/progress/quests/${quest.code}/claim`)
        .set(auth(user.token))
        .expect(200);
      expect(claim.body.coins).toBe(quest.coins);

      const coinsAfter = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).zCoins;
      expect(coinsAfter).toBe(coinsBefore + quest.coins);

      // A second tap must not pay again.
      await request(app.getHttpServer())
        .post(`/api/progress/quests/${quest.code}/claim`)
        .set(auth(user.token))
        .expect(400);
    });

    it('refuses to pay a quest that is not finished', async () => {
      const user = await register('Нетерпеливый');
      const quest = questsForDay(user.id, utcDay().toISOString().slice(0, 10))[0];

      await request(app.getHttpServer())
        .post(`/api/progress/quests/${quest.code}/claim`)
        .set(auth(user.token))
        .expect(400);
    });
  });

  describe('achievements', () => {
    it('unlocks on the first post and never twice', async () => {
      const user = await register('Достигатор');
      await progress.record(user.id, 'POST_PUBLISHED');
      await progress.record(user.id, 'POST_PUBLISHED');

      const unlocks = await prisma.achievementUnlock.findMany({
        where: { userId: user.id, code: 'first_post' },
      });
      expect(unlocks).toHaveLength(1);

      const list = await request(app.getHttpServer())
        .get('/api/progress/achievements')
        .set(auth(user.token))
        .expect(200);
      const first = list.body.find((a: any) => a.code === 'first_post');
      expect(first.unlocked).toBe(true);
      expect(first.unlockedAt).not.toBeNull();
    });

    it('has no achievement for being first in a game — that stays a live plate', () => {
      // First place is borrowed, not earned: it moves to whoever plays better
      // this afternoon, so it belongs on the dynamic "Топ-1" plate and must
      // never be frozen into a permanent collection.
      //
      // What structurally guarantees that is the counter list: every
      // achievement is measured against a counter that only ever goes up,
      // and a leaderboard position is not one of them. Checked here rather
      // than by grepping titles, because a title check both misses a
      // rank-based achievement named something else and trips over innocent
      // words ("Летописец" contains "топ").
      for (const achievement of ACHIEVEMENTS) {
        expect(ACHIEVEMENT_COUNTERS).toContain(achievement.counter);
      }
      const rankish = /rank|position|leader|top|place/i;
      expect(ACHIEVEMENT_COUNTERS.some((counter) => rankish.test(counter))).toBe(false);
    });

    it('shows only unlocked ones on a public profile', async () => {
      const user = await register('Публичный');
      await progress.record(user.id, 'POST_PUBLISHED');

      const publicList = await request(app.getHttpServer())
        .get(`/api/progress/achievements/${user.id}`)
        .expect(200);
      expect(publicList.body.length).toBeGreaterThanOrEqual(1);
      expect(publicList.body.every((a: any) => a.unlockedAt)).toBe(true);
    });
  });

  describe('onboarding', () => {
    it('completes after all five steps and pays 24h Premium once', async () => {
      const user = await register('Новичок');

      for (const step of ONBOARDING_STEPS) {
        await progress.record(user.id, step.event, step.target);
      }

      const state = await request(app.getHttpServer())
        .get('/api/progress')
        .set(auth(user.token))
        .expect(200);
      expect(state.body.onboarding.completed).toBe(true);
      expect(state.body.onboarding.steps.every((s: any) => s.done)).toBe(true);

      await request(app.getHttpServer())
        .post('/api/progress/onboarding/claim')
        .set(auth(user.token))
        .expect(200);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.isPremium).toBe(true);
      expect(row.premiumUntil).not.toBeNull();

      await request(app.getHttpServer())
        .post('/api/progress/onboarding/claim')
        .set(auth(user.token))
        .expect(400);
    });

    it('refuses the reward before the steps are done', async () => {
      const user = await register('Торопыга');
      await request(app.getHttpServer())
        .post('/api/progress/onboarding/claim')
        .set(auth(user.token))
        .expect(400);
    });
  });

  describe('referral goals', () => {
    it('pays a goal once the invites are really there, and only once', async () => {
      const inviter = await register('Пригласитель');
      const goal = REFERRAL_GOALS[0];

      // Not reached yet.
      await request(app.getHttpServer())
        .post(`/api/progress/referral-goals/${goal.code}/claim`)
        .set(auth(inviter.token))
        .expect(400);

      for (let i = 0; i < goal.invites; i += 1) {
        const invitee = await register(`Приглашённый ${i}`);
        await prisma.user.update({ where: { id: invitee.id }, data: { invitedById: inviter.id } });
      }

      const before = (await prisma.user.findUniqueOrThrow({ where: { id: inviter.id } })).zCoins;
      const claim = await request(app.getHttpServer())
        .post(`/api/progress/referral-goals/${goal.code}/claim`)
        .set(auth(inviter.token))
        .expect(200);
      expect(claim.body.coins).toBe(goal.coins);
      expect(claim.body.premiumDays).toBe(goal.premiumDays);

      const after = (await prisma.user.findUniqueOrThrow({ where: { id: inviter.id } })).zCoins;
      expect(after).toBe(before + goal.coins);

      await request(app.getHttpServer())
        .post(`/api/progress/referral-goals/${goal.code}/claim`)
        .set(auth(inviter.token))
        .expect(400);
    });
  });

  describe('seasons', () => {
    it('scores the current season and ranks it', async () => {
      const user = await register('Сезонник');
      await progress.record(user.id, 'POST_PUBLISHED');

      const state = await request(app.getHttpServer())
        .get('/api/progress')
        .set(auth(user.token))
        .expect(200);

      expect(state.body.season.index).toBe(seasonAt().index);
      expect(state.body.season.xp).toBeGreaterThan(0);
      expect(state.body.season.rank).toBeGreaterThanOrEqual(1);
      expect(state.body.season.daysLeft).toBeLessThanOrEqual(28);

      const board = await request(app.getHttpServer())
        .get('/api/progress/season/leaderboard?limit=5')
        .expect(200);
      expect(Array.isArray(board.body)).toBe(true);
      expect(board.body.length).toBeLessThanOrEqual(5);
      if (board.body.length > 1) {
        expect(board.body[0].xp).toBeGreaterThanOrEqual(board.body[1].xp);
      }
    });
  });

  it('requires a login for personal progress', async () => {
    await request(app.getHttpServer()).get('/api/progress').expect(401);
    await request(app.getHttpServer()).post('/api/progress/onboarding/claim').expect(401);
  });
});
