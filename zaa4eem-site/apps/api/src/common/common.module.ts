import { Global, Module } from '@nestjs/common';
import { TelegramNotifyService } from './telegram-notify.service';
import { EmailService } from './email.service';

/**
 * Shared infrastructure every feature may need to reach out through.
 * EmailService lives here rather than in AuthModule because it stopped
 * being an auth detail the moment security, verification and new-device
 * alerts all started sending mail.
 */
@Global()
@Module({
  providers: [TelegramNotifyService, EmailService],
  exports: [TelegramNotifyService, EmailService],
})
export class CommonModule {}
