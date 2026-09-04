import { Module } from '@nestjs/common';
import { ClickerService } from './clicker.service';
import { ClickerController } from './clicker.controller';
import { ShopController } from './shop.controller';

@Module({
  providers: [ClickerService],
  controllers: [ClickerController, ShopController],
})
export class ClickerModule {}
