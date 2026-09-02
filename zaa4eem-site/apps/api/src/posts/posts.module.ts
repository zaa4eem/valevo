import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';

@Module({
  imports: [ModerationModule],
  providers: [PostsService],
  controllers: [PostsController],
})
export class PostsModule {}
