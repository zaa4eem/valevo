import { Module } from '@nestjs/common';
import { ClickerService } from './clicker.service';
import { ClickerController } from './clicker.controller';
import { ShopController } from './shop.controller';

@Module({
  providers: [ClickerService],
  controllers: [ClickerController, ShopController],
  // UsersModule needs this for the "Топ-1 Z-Кликер" profile badge.
  exports: [ClickerService],
})
export class ClickerModule {}
