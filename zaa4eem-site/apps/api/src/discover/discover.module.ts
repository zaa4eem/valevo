import { Module } from '@nestjs/common';
import { DiscoverService } from './discover.service';
import { DiscoverController } from './discover.controller';

@Module({
  providers: [DiscoverService],
  controllers: [DiscoverController],
})
export class DiscoverModule {}
