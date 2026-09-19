import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { interval, map, merge, type Observable } from 'rxjs';
import { placePixelSchema } from '@zaa4eem/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { PixelEventsService } from './pixel-events.service';
import { PixelCooldownError, PixelService } from './pixel.service';

/** Comment frames keep proxies from treating an idle canvas as a dead connection. */
const SSE_KEEPALIVE_MS = 25_000;

@Controller('pixel')
export class PixelController {
  constructor(
    private readonly pixel: PixelService,
    private readonly events: PixelEventsService,
  ) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get('state')
  state(@Req() req: Request & { user?: RequestUser }) {
    return this.pixel.state(req.user?.id);
  }

  /**
   * The canvas as raw bytes.
   *
   * no-store rather than a short cache: the point of the canvas is that it
   * changes, and a viewer who gets a cached snapshot plus the live stream
   * would see everyone else's pixels except the ones placed during the
   * cached window — the least debuggable possible failure.
   */
  @Get('snapshot')
  @Header('Content-Type', 'application/octet-stream')
  @Header('Cache-Control', 'no-store')
  async snapshot(@Res() res: Response) {
    res.send(await this.pixel.snapshot());
  }

  @UseGuards(JwtAuthGuard)
  // The cooldown is the real limit; this only stops a client hammering the
  // endpoint to find out exactly when it lifts.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  async place(
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = placePixelSchema.parse(body);
    try {
      return await this.pixel.place(user.id, input);
    } catch (err) {
      if (err instanceof PixelCooldownError) {
        // Retry-After rather than an extra field in the error body:
        // HttpExceptionFilter normalises every error to the documented
        // { statusCode, error, message }, and widening that shape for one
        // endpoint would be a worse trade than using the header HTTP
        // already has for exactly this. The web client re-reads /state
        // anyway, which also resyncs a clock that has drifted.
        res.setHeader('Retry-After', Math.ceil(err.remainingMs / 1000));
        throw new BadRequestException(
          `Следующий пиксель можно поставить через ${formatWait(err.remainingMs)}`,
        );
      }
      throw err;
    }
  }

  @Get('cell/:x/:y')
  cell(@Param('x', ParseIntPipe) x: number, @Param('y', ParseIntPipe) y: number) {
    return this.pixel.cell(x, y);
  }

  /**
   * Live placements. No ticket, unlike the notifications stream: the canvas
   * is public, and a signed-out visitor watching it fill is exactly the
   * person this feature exists to hook.
   */
  @Sse('stream')
  stream(): Observable<{ data: string }> {
    const updates = this.events.all().pipe(map((event) => ({ data: JSON.stringify(event) })));
    const keepalive = interval(SSE_KEEPALIVE_MS).pipe(map(() => ({ data: JSON.stringify({ ping: true }) })));
    return merge(updates, keepalive);
  }
}

/** "12 мин" / "40 сек" — the error says how long, so the client need not guess. */
function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} сек`;
  return `${Math.ceil(seconds / 60)} мин`;
}
