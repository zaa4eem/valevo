import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deliberately excluded from the global "api" prefix (see main.ts) so it's
 * reachable at the container root — that's what Docker's own HEALTHCHECK
 * and an external uptime monitor hit, neither of which should need to know
 * about API path versioning.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('База данных недоступна');
    }
    return { status: 'ok', db: true, uptime: process.uptime() };
  }
}
