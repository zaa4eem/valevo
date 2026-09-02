import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { createCommentSchema, createPostSchema, updatePostSchema } from '@zaa4eem/shared';
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  list(@Req() req: Request & { user?: RequestUser }) {
    return this.posts.listPublished({
      viewerId: req.user?.id,
      viewerIsOwner: req.user?.role === 'OWNER',
    });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const input = createPostSchema.parse(body);
    return this.posts.create(user.id, input.body, input.publish, user.role === 'OWNER');
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() body: unknown) {
    await this.assertAuthorOrOwner(id, user);
    const input = updatePostSchema.parse(body);
    return this.posts.update(id, { body: input.body, publish: input.publish });
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.assertAuthorOrOwner(id, user);
    await this.posts.delete(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  like(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.posts.like(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/like')
  unlike(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.posts.unlike(id, user.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/comments')
  listComments(@Param('id') id: string, @Req() req: Request & { user?: RequestUser }) {
    return this.posts.listComments(id, { viewerIsOwner: req.user?.role === 'OWNER' });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/comments')
  createComment(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() body: unknown) {
    const input = createCommentSchema.parse(body);
    return this.posts.createComment(id, user.id, input.body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/comments/:commentId')
  async removeComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.posts.deleteComment(id, commentId, { id: user.id, isOwner: user.role === 'OWNER' });
  }

  private async assertAuthorOrOwner(postId: string, user: RequestUser) {
    if (user.role === 'OWNER') return;
    const authorId = await this.posts.getAuthorId(postId);
    if (authorId !== user.id) {
      throw new ForbiddenException('You can only edit your own posts');
    }
  }
}
