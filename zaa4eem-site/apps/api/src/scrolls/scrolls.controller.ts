import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  createScrollCommentSchema,
  createScrollSchema,
  reviewScrollSchema,
  scrollFeedQuerySchema,
} from '@zaa4eem/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { ScrollsService } from './scrolls.service';
import { scrollUploadOptions } from './video-storage';
import { safeUnlink } from './transcode.service';

@Controller('scrolls')
export class ScrollsController {
  constructor(private readonly scrolls: ScrollsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  feed(@Query() query: unknown, @Req() req: Request & { user?: RequestUser }) {
    return this.scrolls.feed(scrollFeedQuerySchema.parse(query), req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@CurrentUser() user: RequestUser) {
    return this.scrolls.mine(user.id);
  }

  /**
   * Upload.
   *
   * Throttled hard: each call parks up to 80MB on disk and then occupies a
   * CPU for the length of a transcode, so this is the most expensive thing
   * an account can ask the server to do.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @Post()
  @UseInterceptors(FileInterceptor('video', scrollUploadOptions))
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ) {
    if (!file) throw new BadRequestException('Выберите видео');
    let caption: string;
    try {
      ({ caption } = createScrollSchema.parse(body ?? {}));
    } catch (err) {
      // The file is already on disk by the time the body is validated, so a
      // rejected caption must not leave it there.
      await safeUnlink(file.path);
      throw err;
    }
    return this.scrolls.createFromUpload(user.id, file.path, caption);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  like(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.scrolls.like(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/like')
  unlike(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.scrolls.unlike(id, user.id);
  }

  @Get(':id/comments')
  comments(@Param('id', ParseUUIDPipe) id: string) {
    return this.scrolls.comments(id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/comments')
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    return this.scrolls.comment(id, user.id, createScrollCommentSchema.parse(body));
  }

  /**
   * A view. No auth, because a signed-out viewer's watch is still a watch,
   * and throttled rather than deduplicated per user for the same reason —
   * the count is a rough popularity signal, not an analytics figure.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  async view(@Param('id', ParseUUIDPipe) id: string) {
    await this.scrolls.view(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    await this.scrolls.remove(id, user.id, user.role === 'OWNER');
  }

  // --- Moderation --------------------------------------------------------

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Get('moderation/queue')
  queue() {
    return this.scrolls.pending();
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Post('moderation/:id')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    const input = reviewScrollSchema.parse(body);
    return this.scrolls.review(id, user.id, input.approve, input.reason);
  }
}
