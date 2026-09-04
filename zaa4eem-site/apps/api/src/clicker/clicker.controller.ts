import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { clickBatchSchema } from '@zaa4eem/shared';
import { ClickerService } from './clicker.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';

@Controller('clicker')
export class ClickerController {
  constructor(private readonly clicker: ClickerService) {}

  @UseGuards(JwtAuthGuard)
  @Get('state')
  getState(@CurrentUser() user: RequestUser) {
    return this.clicker.getState(user.id);
  }

  // A generous ceiling over the client's own ~500ms batching interval — this
  // isn't the real anti-cheat boundary (the daily cap in ClickerService is),
  // just a backstop against a client gone haywire.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 8, ttl: 1_000 } })
  @Post('click')
  click(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const { count } = clickBatchSchema.parse(body);
    return this.clicker.click(user.id, count);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('upgrade')
  upgrade(@CurrentUser() user: RequestUser) {
    return this.clicker.upgrade(user.id);
  }

  @Get('leaderboard')
  leaderboard(@Query('limit') limit?: string) {
    return this.clicker.leaderboard(limit ? Number(limit) : undefined);
  }
}
