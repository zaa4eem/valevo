import { Module } from '@nestjs/common';
import { ProgressModule } from '../progress/progress.module';
import { PixelController } from './pixel.controller';
import { PixelEventsService } from './pixel-events.service';
import { PixelService } from './pixel.service';

@Module({
  imports: [ProgressModule],
  controllers: [PixelController],
  providers: [PixelService, PixelEventsService],
})
export class PixelModule {}
