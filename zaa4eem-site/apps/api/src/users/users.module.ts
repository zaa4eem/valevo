import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ModerationModule } from '../moderation/moderation.module';
import { GamesModule } from '../games/games.module';
import { ClickerModule } from '../clicker/clicker.module';

@Module({
  imports: [ModerationModule, GamesModule, ClickerModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
