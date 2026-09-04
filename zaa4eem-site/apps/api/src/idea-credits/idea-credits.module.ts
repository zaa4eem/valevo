import { Module } from '@nestjs/common';
import { IdeaCreditsService } from './idea-credits.service';
import { IdeaCreditsController } from './idea-credits.controller';

@Module({
  providers: [IdeaCreditsService],
  controllers: [IdeaCreditsController],
})
export class IdeaCreditsModule {}
