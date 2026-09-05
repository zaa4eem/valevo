import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { ProgressViewService } from './progress-view.service';

@Controller('progress')
export class ProgressController {
  constructor(private readonly view: ProgressViewService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  state(@CurrentUser() user: RequestUser) {
    return this.view.getState(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('achievements')
  achievements(@CurrentUser() user: RequestUser) {
    return this.view.getAchievements(user.id);
  }

  /** Public: the collection shown on someone else's profile — unlocks only, no progress towards locked ones. */
  @Get('achievements/:userId')
  publicAchievements(@Param('userId') userId: string) {
    return this.view.getUnlockedAchievements(userId);
  }

  @Get('season/leaderboard')
  seasonLeaderboard(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.view.seasonLeaderboard(
      Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('quests/:code/claim')
  @HttpCode(HttpStatus.OK)
  claimQuest(@CurrentUser() user: RequestUser, @Param('code') code: string) {
    return this.view.claimQuest(user.id, code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('onboarding/claim')
  @HttpCode(HttpStatus.OK)
  claimOnboarding(@CurrentUser() user: RequestUser) {
    return this.view.claimOnboarding(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('referral-goals/:code/claim')
  @HttpCode(HttpStatus.OK)
  claimReferralGoal(@CurrentUser() user: RequestUser, @Param('code') code: string) {
    return this.view.claimReferralGoal(user.id, code);
  }
}
