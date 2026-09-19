import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProgressModule } from '../progress/progress.module';
import { ScrollsController } from './scrolls.controller';
import { ScrollsService } from './scrolls.service';
import { TranscodeService } from './transcode.service';

@Module({
  imports: [ProgressModule, NotificationsModule],
  controllers: [ScrollsController],
  providers: [ScrollsService, TranscodeService],
})
export class ScrollsModule {}
