import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './common/health.controller';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { ModerationModule } from './moderation/moderation.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { IdeasModule } from './ideas/ideas.module';
import { GamesModule } from './games/games.module';
import { AdminModule } from './admin/admin.module';
import { SearchModule } from './search/search.module';
import { ClickerModule } from './clicker/clicker.module';
import { DigestModule } from './digest/digest.module';
import { IdeaCreditsModule } from './idea-credits/idea-credits.module';
import { NotificationsModule } from './notifications/notifications.module';
import { validateEnv } from './config-validate';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
        // Rate limits would otherwise trip on their own e2e suite: dozens of
        // specs share one in-process "IP" and blow past a tight per-route
        // limit (e.g. 5/min on POST /posts) well before real traffic ever
        // would.
        skipIf: () => process.env.NODE_ENV === 'test',
      },
    ]),
    PrismaModule,
    CommonModule,
    ModerationModule,
    UsersModule,
    AuthModule,
    PostsModule,
    IdeasModule,
    GamesModule,
    AdminModule,
    SearchModule,
    ClickerModule,
    DigestModule,
    IdeaCreditsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
