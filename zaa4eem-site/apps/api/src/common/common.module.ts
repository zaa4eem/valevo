import { Global, Module } from '@nestjs/common';
import { TelegramNotifyService } from './telegram-notify.service';

@Global()
@Module({
  providers: [TelegramNotifyService],
  exports: [TelegramNotifyService],
})
export class CommonModule {}
