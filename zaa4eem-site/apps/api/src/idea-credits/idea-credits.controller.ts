import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { createIdeaCreditSchema } from '@zaa4eem/shared';
import { IdeaCreditsService } from './idea-credits.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OwnerGuard } from '../auth/owner.guard';

@Controller('idea-credits')
export class IdeaCreditsController {
  constructor(private readonly credits: IdeaCreditsService) {}

  /** Public "Зал славы" list — anyone can see who proposed what. */
  @Get()
  list() {
    return this.credits.list();
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Post()
  create(@Body() body: unknown) {
    const input = createIdeaCreditSchema.parse(body);
    return this.credits.create(input.userId, input.description);
  }

  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.credits.delete(id);
  }
}
