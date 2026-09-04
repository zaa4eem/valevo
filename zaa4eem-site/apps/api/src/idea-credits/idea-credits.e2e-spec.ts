import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)('Idea credits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const email = `credit-owner-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Credit Owner' });
    await prisma.user.update({ where: { email }, data: { role: 'OWNER' } });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' });
    ownerToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks a non-owner from creating a credit', async () => {
    const email = `credit-sub-${Date.now()}@test.dev`;
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Subscriber' });

    await request(app.getHttpServer())
      .post('/api/idea-credits')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .send({ userId: register.body.user.id, description: 'Пытаюсь начислить себе' })
      .expect(403);
  });

  it('lets the owner credit a user, shows it in the public list and on that user profile, and can delete it', async () => {
    const email = `credit-target-${Date.now()}@test.dev`;
    const target = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Credit Target' });
    const userId = target.body.user.id as string;

    const uniqueDescription = `Уведомление о рекорде ${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/idea-credits')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId, description: uniqueDescription })
      .expect(201);
    expect(created.body.id).toEqual(expect.any(String));

    const list = await request(app.getHttpServer()).get('/api/idea-credits').expect(200);
    const entry = list.body.find((c: any) => c.id === created.body.id);
    expect(entry).toBeDefined();
    expect(entry.description).toBe(uniqueDescription);
    expect(entry.user.id).toBe(userId);

    const profile = await request(app.getHttpServer()).get(`/api/users/${userId}`).expect(200);
    expect(profile.body.ideaCredits).toHaveLength(1);
    expect(profile.body.ideaCredits[0].description).toBe(uniqueDescription);

    await request(app.getHttpServer())
      .delete(`/api/idea-credits/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const profileAfterDelete = await request(app.getHttpServer()).get(`/api/users/${userId}`).expect(200);
    expect(profileAfterDelete.body.ideaCredits).toHaveLength(0);
  });

  it('404s crediting a nonexistent user', async () => {
    await request(app.getHttpServer())
      .post('/api/idea-credits')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: '00000000-0000-0000-0000-000000000000', description: 'Кому-то несуществующему' })
      .expect(404);
  });
});
