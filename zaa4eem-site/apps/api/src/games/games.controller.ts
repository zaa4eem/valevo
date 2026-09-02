import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { submitScoreSchema } from '@zaa4eem/shared';
import { GamesService } from './games.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';

@Controller()
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get('games')
  list() {
    return this.games.listActive();
  }

  @Get('games/:slug')
  get(@Param('slug') slug: string) {
    return this.games.getBySlug(slug);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('games/:slug/scores')
  submitScore(
    @Param('slug') slug: string,
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    const { value } = submitScoreSchema.parse(body);
    return this.games.submitScore(slug, user.id, value);
  }

  @Get('games/:slug/leaderboard')
  leaderboard(@Param('slug') slug: string, @Query('limit') limit?: string) {
    return this.games.leaderboardForGame(slug, limit ? Number(limit) : undefined);
  }

  @Get('leaderboard/global')
  globalLeaderboard(@Query('limit') limit?: string) {
    return this.games.globalLeaderboard(limit ? Number(limit) : undefined);
  }
}
