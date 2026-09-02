import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { createPostSchema, updatePostSchema } from '@zaa4eem/shared';
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list() {
    return this.posts.listPublished();
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const input = createPostSchema.parse(body);
    return this.posts.create(user.id, input.body, input.publish);
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const input = updatePostSchema.parse(body);
    return this.posts.update(id, { body: input.body, publish: input.publish });
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.posts.delete(id);
  }
}
