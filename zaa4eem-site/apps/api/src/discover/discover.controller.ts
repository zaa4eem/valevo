import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import type { RequestUser } from '../auth/current-user.decorator';
import { DiscoverService } from './discover.service';

@Controller('discover')
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  /**
   * Optional auth on purpose: a signed-out visitor still gets something to
   * look at, and a signed-in one gets it personalised.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  get(@Req() req: Request & { user?: RequestUser }) {
    return this.discover.get(req.user?.id, req.user?.role === 'OWNER');
  }

  /**
   * Who else the people following this profile follow.
   *
   * Optional auth for the same reason as above — a visitor reading someone's
   * profile is exactly who this block is for.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('similar/:userId')
  similar(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request & { user?: RequestUser },
  ) {
    return this.discover.similar(userId, req.user?.id);
  }
}
