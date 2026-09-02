import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { moderationActionSchema } from '@zaa4eem/shared';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, OwnerGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('moderation-queue')
  moderationQueue() {
    return this.admin.moderationQueue();
  }

  @Get('moderation-log')
  moderationLog() {
    return this.admin.moderationLog();
  }

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Post('users/:id/mute')
  async mute(@Param('id') id: string, @CurrentUser() actor: RequestUser, @Body() body: unknown) {
    const { reason } = moderationActionSchema.parse(body);
    await this.admin.muteUser(id, actor.id, reason);
  }

  @Post('users/:id/ban')
  async ban(@Param('id') id: string, @CurrentUser() actor: RequestUser, @Body() body: unknown) {
    const { reason } = moderationActionSchema.parse(body);
    await this.admin.banUser(id, actor.id, reason);
  }
}
