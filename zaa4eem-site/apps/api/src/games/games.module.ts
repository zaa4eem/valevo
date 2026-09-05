import { Module } from '@nestjs/common';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';

@Module({
  providers: [GamesService],
  controllers: [GamesController],
  // UsersModule needs this for the "Топ-1" profile badge (comparing a
  // profile's userId against the live leaderboard's rank-1 holder).
  exports: [GamesService],
})
export class GamesModule {}
