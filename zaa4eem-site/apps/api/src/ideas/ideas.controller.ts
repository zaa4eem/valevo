import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  createIdeaSchema,
  ideasQuerySchema,
  updateIdeaModerationSchema,
  updateIdeaStatusSchema,
} from '@zaa4eem/shared';
import { IdeasService } from './ideas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

@Controller('ideas')
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  list(@Query() query: unknown, @Req() req: Request & { user?: RequestUser }) {
    const { sort } = ideasQuerySchema.parse(query);
    return this.ideas.list({
      sort,
      viewerId: req.user?.id,
      viewerIsOwner: req.user?.role === 'OWNER',
    });
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request & { user?: RequestUser }) {
    return this.ideas.getById(id, req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    const input = createIdeaSchema.parse(body);
    return this.ideas.create(user.id, input.title, input.description);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/vote')
  vote(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.ideas.vote(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/vote')
  unvote(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.ideas.unvote(id, user.id);
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() body: unknown) {
    const { status } = updateIdeaStatusSchema.parse(body);
    return this.ideas.setStatus(id, status, user.id);
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Patch(':id/moderation')
  setModeration(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    const { moderationState, reason } = updateIdeaModerationSchema.parse(body);
    return this.ideas.setModeration(id, moderationState, user.id, reason);
  }
}
