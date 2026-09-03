import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { updateProfileSchema } from '@zaa4eem/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { ModerationService } from '../moderation/moderation.service';
import { avatarUploadOptions } from './avatar-storage';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly moderation: ModerationService,
    private readonly config: ConfigService,
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

    // Bio and status text pass the moderation filter before being saved (FR-027).
    for (const text of [input.bio, input.statusText]) {
      if (text && this.moderation.classify(text) === 'PENDING_REVIEW') {
        // Held rather than rejected: keep the previous value, surface the issue.
        throw new BadRequestException('Text did not pass content review — please rephrase.');
      }
    }

    const updated = await this.users.updateProfile(user.id, input);
    return this.users.getPublicProfile(updated.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', avatarUploadOptions))
  async uploadAvatar(@CurrentUser() user: RequestUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const origin = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001');
    const avatarUrl = `${origin}/uploads/avatars/${file.filename}`;
    await this.users.updateProfile(user.id, { avatarUrl });
    return this.users.getPublicProfile(user.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async byId(@Param('id') id: string, @Req() req: Request & { user?: RequestUser }) {
    const profile = await this.users.getPublicProfile(id, req.user?.id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/follow')
  follow(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.users.follow(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/follow')
  unfollow(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.users.unfollow(user.id, id);
  }
}
