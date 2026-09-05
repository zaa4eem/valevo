import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationEventsService } from './notification-events.service';
import { PushService } from './push.service';
import { ReEngagementService } from './re-engagement.service';

/**
 * Global because almost every feature needs to raise a notification —
 * posts, ideas, follows and games would otherwise all have to import this
 * module explicitly just to reach the one service.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [NotificationsService, NotificationEventsService, PushService, ReEngagementService],
  controllers: [NotificationsController],
  exports: [NotificationsService, PushService, ReEngagementService],
})
export class NotificationsModule {}
