import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import * as fs from 'fs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  avatarGifCropSchema,
  updatePremiumStyleSchema,
  updateProfileSchema,
  userListQuerySchema,
} from '@zaa4eem/shared';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { ModerationService } from '../moderation/moderation.service';
import { matchesImageSignature } from '../common/image-signature';
import { avatarUploadOptions } from './avatar-storage';
import { bannerUploadOptions } from './banner-storage';
import { cropGifInPlace } from './gif-crop.util';

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
    if (!profile) throw new NotFoundException('Пользователь не найден');
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
        throw new BadRequestException('Текст не прошёл проверку — попробуйте переформулировать.');
      }
    }

    const updated = await this.users.updateProfile(user.id, input);
    return this.users.getPublicProfile(updated.id);
  }

  // Self-service style picker for a user the owner already granted Premium
  // to — see PATCH /admin/users/:id/premium for the owner-only grant/revoke.
  @UseGuards(JwtAuthGuard)
  @Patch('me/premium')
  async updateMyPremiumStyle(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const input = updatePremiumStyleSchema.parse(body);
    await this.users.updatePremiumStyle(user.id, input);
    return this.users.getPublicProfile(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', avatarUploadOptions))
  async uploadAvatar(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: unknown,
  ) {
    if (!file) throw new BadRequestException('Файл не загружен');
    if (!(await matchesImageSignature(file.path, file.mimetype))) {
      await fs.promises.rm(file.path, { force: true });
      throw new BadRequestException('Файл повреждён или не является изображением заявленного типа');
    }
    if (file.mimetype === 'image/gif') {
      // A GIF can't go through the JPEG/PNG/WEBP path's <canvas> crop — that
      // would capture a single static frame and kill the animation. The
      // cropper instead sends the crop rectangle alongside the untouched
      // file, and gifsicle re-crops every frame of the GIF itself.
      const crop = avatarGifCropSchema.safeParse(body);
      if (crop.success) {
        await cropGifInPlace(file.path, { x: crop.data.cropX, y: crop.data.cropY, size: crop.data.cropSize });
      }
    }
    const origin = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001');
    const avatarUrl = `${origin}/uploads/avatars/${file.filename}`;
    await this.users.updateProfile(user.id, { avatarUrl });
    return this.users.getPublicProfile(user.id);
  }

  // Premium-only, unlike the avatar upload above — checked here (after the
  // file already landed on disk, same as the signature check below) rather
  // than in a guard, since the profile's current isPremium needs a fresh DB
  // read anyway (ensurePremiumFresh, via getPublicProfile) to rule out a
  // lapsed grant nobody's touched since it expired.
  @UseGuards(JwtAuthGuard)
  @Post('me/banner')
  @UseInterceptors(FileInterceptor('banner', bannerUploadOptions))
  async uploadBanner(@CurrentUser() user: RequestUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не загружен');
    const profile = await this.users.getPublicProfile(user.id);
    if (!profile?.isPremium) {
      await fs.promises.rm(file.path, { force: true });
      throw new ForbiddenException('Баннер профиля доступен только Premium-пользователям');
    }
    if (!(await matchesImageSignature(file.path, file.mimetype))) {
      await fs.promises.rm(file.path, { force: true });
      throw new BadRequestException('Файл повреждён или не является изображением заявленного типа');
    }
    const origin = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001');
    const bannerUrl = `${origin}/uploads/banners/${file.filename}`;
    await this.users.updateProfile(user.id, { bannerUrl });
    return this.users.getPublicProfile(user.id);
  }

  // Fired by the frontend's interaction-driven heartbeat (auth-context.tsx) —
  // throttled client-side to ~once/minute already, this is just a floor so a
  // misbehaving tab can't hammer it.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('me/heartbeat')
  async heartbeat(@CurrentUser() user: RequestUser) {
    await this.users.heartbeat(user.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async byId(@Param('id') id: string, @Req() req: Request & { user?: RequestUser }) {
    const profile = await this.users.getPublicProfile(id, req.user?.id);
    if (!profile) throw new NotFoundException('Пользователь не найден');
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

  @Get(':id/followers')
  followers(@Param('id') id: string, @Query() query: unknown) {
    const { cursor, limit } = userListQuerySchema.parse(query);
    return this.users.getFollowers(id, { cursor, limit });
  }

  @Get(':id/following')
  following(@Param('id') id: string, @Query() query: unknown) {
    const { cursor, limit } = userListQuerySchema.parse(query);
    return this.users.getFollowing(id, { cursor, limit });
  }
}
