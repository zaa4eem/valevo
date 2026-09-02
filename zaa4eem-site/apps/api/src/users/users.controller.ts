import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { updateProfileSchema } from '@zaa4eem/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { ModerationService } from '../moderation/moderation.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly moderation: ModerationService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const profile = await this.users.getPublicProfile(user.id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const input = updateProfileSchema.parse(body);

    // Bio passes the moderation filter before being saved (FR-027).
    if (input.bio) {
      const state = this.moderation.classify(input.bio);
      if (state === 'PENDING_REVIEW') {
        // Held rather than rejected: keep the previous bio, surface the issue.
        throw new BadRequestException('Bio did not pass content review — please rephrase.');
      }
    }

    const updated = await this.users.updateProfile(user.id, input);
    return this.users.getPublicProfile(updated.id);
  }

  @Get(':id')
  async byId(@Param('id') id: string) {
    const profile = await this.users.getPublicProfile(id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }
}
