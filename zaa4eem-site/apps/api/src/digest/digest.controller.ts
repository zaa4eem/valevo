import { Controller, Post, UseGuards } from '@nestjs/common';
import { DigestService } from './digest.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OwnerGuard } from '../auth/owner.guard';

@Controller('admin/digest')
@UseGuards(JwtAuthGuard, OwnerGuard)
export class DigestController {
  constructor(private readonly digest: DigestService) {}

  /** Manual trigger for testing — the real cadence is the 3-day interval in DigestService. */
  @Post('send-now')
  async sendNow() {
    const text = await this.digest.sendDigest();
    return { sent: text !== null, text };
  }
}
