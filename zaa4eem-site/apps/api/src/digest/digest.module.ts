import { Module } from '@nestjs/common';
import { DigestService } from './digest.service';
import { DigestController } from './digest.controller';

@Module({
  providers: [DigestService],
  controllers: [DigestController],
})
export class DigestModule {}
