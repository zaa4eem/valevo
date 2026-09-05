import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { interval, map, merge, type Observable } from 'rxjs';
import {
  notificationsQuerySchema,
  pushSubscriptionSchema,
  updateNotificationPrefsSchema,
} from '@zaa4eem/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationEventsService } from './notification-events.service';
import { PushService } from './push.service';
import { ReEngagementService } from './re-engagement.service';
import { OwnerGuard } from '../auth/owner.guard';

/** Purpose claim that stops a stream ticket being usable as a normal access token, and vice versa. */
const SSE_TICKET_PURPOSE = 'notifications-sse';
const SSE_TICKET_TTL = '60s';
/** Comment frames keep proxies from treating an idle stream as dead. */
const SSE_KEEPALIVE_MS = 25_000;

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly events: NotificationEventsService,
    private readonly push: PushService,
    private readonly reEngagement: ReEngagementService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: unknown) {
    return this.notifications.list(user.id, notificationsQuerySchema.parse(query));
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestUser) {
    return { unreadCount: await this.notifications.unreadCount(user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async readAll(@CurrentUser() user: RequestUser) {
    return { unreadCount: await this.notifications.markAllRead(user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async read(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return { unreadCount: await this.notifications.markRead(user.id, id) };
  }

  @UseGuards(JwtAuthGuard)
  @Get('prefs')
  prefs(@CurrentUser() user: RequestUser) {
    return this.notifications.getPrefs(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('prefs')
  updatePrefs(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.notifications.updatePrefs(user.id, updateNotificationPrefsSchema.parse(body));
  }

  // ---- Web Push ----

  @Get('push/public-key')
  publicKey() {
    return { publicKey: this.push.getPublicKey() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('push/subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribePush(@CurrentUser() user: RequestUser, @Body() body: unknown, @Req() req: Request) {
    const input = pushSubscriptionSchema.parse(body);
    await this.push.subscribe(user.id, input, req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('push/subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribePush(@Body() body: unknown) {
    const { endpoint } = pushSubscriptionSchema.pick({ endpoint: true }).parse(body);
    await this.push.unsubscribe(endpoint);
  }

  /** Manual trigger for the win-back sweep — the real cadence is the interval in ReEngagementService. */
  @UseGuards(JwtAuthGuard, OwnerGuard)
  @Post('win-back/run')
  @HttpCode(HttpStatus.OK)
  async runWinBack() {
    return { sent: await this.reEngagement.sweep() };
  }

  // ---- Live stream ----

  /**
   * EventSource can't send an Authorization header, and the refresh cookie is
   * scoped to /api/auth so it never reaches here either. Rather than putting
   * a long-lived access token in a query string (where it ends up in every
   * proxy and access log), the client trades its token for this: a signed,
   * single-purpose ticket that expires in a minute.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('stream-ticket')
  @HttpCode(HttpStatus.OK)
  streamTicket(@CurrentUser() user: RequestUser) {
    const ticket = this.jwt.sign(
      { sub: user.id, purpose: SSE_TICKET_PURPOSE },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: SSE_TICKET_TTL,
      },
    );
    return { ticket };
  }

  @Sse('stream')
  stream(@Query('ticket') ticket?: string): Observable<{ data: string }> {
    if (!ticket) throw new UnauthorizedException('Нет билета для подключения');

    let userId: string;
    try {
      const payload = this.jwt.verify<{ sub: string; purpose?: string }>(ticket, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      if (payload.purpose !== SSE_TICKET_PURPOSE) {
        throw new UnauthorizedException('Билет не для этого подключения');
      }
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('Билет недействителен или истёк');
    }

    const updates = this.events
      .forUser(userId)
      .pipe(map((event) => ({ data: JSON.stringify({ unreadCount: event.unreadCount }) })));

    const keepalive = interval(SSE_KEEPALIVE_MS).pipe(map(() => ({ data: JSON.stringify({ ping: true }) })));

    return merge(updates, keepalive);
  }
}
