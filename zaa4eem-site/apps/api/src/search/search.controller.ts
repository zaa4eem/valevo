import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { searchQuerySchema } from '@zaa4eem/shared';
import { SearchService } from './search.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { RequestUser } from '../auth/current-user.decorator';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  get(@Query() query: unknown, @Req() req: Request & { user?: RequestUser }) {
    const { q } = searchQuerySchema.parse(query);
    return this.search.search(q, req.user?.role === 'OWNER');
  }
}
