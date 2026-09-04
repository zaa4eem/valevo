import { Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClickerService } from './clicker.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';

@Controller('shop')
export class ShopController {
  constructor(private readonly clicker: ClickerService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('premium')
  async buyPremium(@CurrentUser() user: RequestUser) {
    await this.clicker.buyPremium(user.id);
    return { ok: true };
  }
}
