import { Global, Module } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { ProgressViewService } from './progress-view.service';
import { ProgressController } from './progress.controller';

/**
 * Global for the same reason NotificationsModule is: posts, ideas, games,
 * follows and the clicker all report progress, and none of them should have
 * to import a module to do it.
 */
@Global()
@Module({
  providers: [ProgressService, ProgressViewService],
  controllers: [ProgressController],
  exports: [ProgressService, ProgressViewService],
})
export class ProgressModule {}
