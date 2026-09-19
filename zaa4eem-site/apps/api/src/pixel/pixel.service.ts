import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PIXEL_CANVAS_SIZE,
  PIXEL_CELL_COUNT,
  PIXEL_COOLDOWN_MS,
  PIXEL_COOLDOWN_PREMIUM_MS,
  type PixelCell,
  type PixelState,
  type PlacePixelInput,
} from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService } from '../progress/progress.service';
import { ensurePremiumFresh } from '../common/premium.util';
import { PixelEventsService } from './pixel-events.service';

/** How far back "рисует сейчас" looks. */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How many past placements one cell shows. */
const CELL_HISTORY = 10;

/** Raised when someone paints before their cooldown is up. */
export class PixelCooldownError extends Error {
  constructor(readonly remainingMs: number) {
    super('Ещё рано ставить следующий пиксель');
  }
}

@Injectable()
export class PixelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: PixelEventsService,
    private readonly progress: ProgressService,
  ) {}

  /**
   * The whole canvas as one byte per cell, row-major.
   *
   * Sent as bytes rather than JSON deliberately: 62 500 cells is 62 KB flat
   * (and a few hundred bytes gzipped while the canvas is mostly empty),
   * where the same thing as `[{x,y,color}, …]` would be megabytes once the
   * canvas fills, on the one request every single visitor makes.
   */
  async snapshot(): Promise<Buffer> {
    const cells = await this.prisma.pixelCell.findMany({ select: { x: true, y: true, color: true } });
    const bytes = Buffer.alloc(PIXEL_CELL_COUNT);
    for (const cell of cells) {
      bytes[cell.y * PIXEL_CANVAS_SIZE + cell.x] = cell.color;
    }
    return bytes;
  }

  async state(userId: string | undefined): Promise<PixelState> {
    const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const [paintedCount, activePainters, cooldown] = await Promise.all([
      this.prisma.pixelCell.count(),
      this.prisma.pixelPlacement
        .findMany({
          where: { createdAt: { gte: since } },
          select: { userId: true },
          distinct: ['userId'],
        })
        .then((rows) => rows.length),
      this.cooldownFor(userId),
    ]);

    return {
      size: PIXEL_CANVAS_SIZE,
      paintedCount,
      activePainters,
      cooldownMs: cooldown.cooldownMs,
      cooldownRemainingMs: cooldown.remainingMs,
    };
  }

  async place(userId: string, input: PlacePixelInput) {
    const cooldown = await this.cooldownFor(userId);
    if (cooldown.remainingMs > 0) throw new PixelCooldownError(cooldown.remainingMs);

    const now = new Date();
    // One transaction so a placement can never be logged without the canvas
    // moving, or the other way round — the log is what the cooldown reads,
    // so a half-applied placement would hand out a free pixel.
    await this.prisma.$transaction([
      this.prisma.pixelCell.upsert({
        where: { x_y: { x: input.x, y: input.y } },
        create: { x: input.x, y: input.y, color: input.color, painterId: userId, paintedAt: now },
        update: { color: input.color, painterId: userId, paintedAt: now },
      }),
      this.prisma.pixelPlacement.create({
        data: { x: input.x, y: input.y, color: input.color, userId, createdAt: now },
      }),
    ]);

    this.events.publish({ x: input.x, y: input.y, color: input.color });
    // Not awaited: XP, quests and achievements must never make the person
    // wait for their pixel to appear, and ProgressService swallows its own
    // failures.
    void this.progress.record(userId, 'PIXEL_PLACED');

    return { cooldownRemainingMs: cooldown.cooldownMs, cooldownMs: cooldown.cooldownMs };
  }

  async cell(x: number, y: number): Promise<PixelCell> {
    if (x < 0 || y < 0 || x >= PIXEL_CANVAS_SIZE || y >= PIXEL_CANVAS_SIZE) {
      throw new NotFoundException('Такой клетки нет на холсте');
    }

    const [cell, history] = await Promise.all([
      this.prisma.pixelCell.findUnique({ where: { x_y: { x, y } } }),
      this.prisma.pixelPlacement.findMany({
        where: { x, y },
        include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
        take: CELL_HISTORY,
      }),
    ]);

    return {
      x,
      y,
      color: cell?.color ?? 0,
      history: history.map((h) => ({
        color: h.color,
        createdAt: h.createdAt.toISOString(),
        user: h.user,
      })),
    };
  }

  /**
   * Cooldown from the placement log, not from a stored timestamp.
   *
   * One source of truth: the log is written in the same transaction as the
   * cell, so there is no way for "when did you last paint" to drift from
   * "what did you paint".
   */
  private async cooldownFor(userId: string | undefined) {
    if (!userId) return { cooldownMs: PIXEL_COOLDOWN_MS, remainingMs: 0 };

    const [user, last] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.pixelPlacement.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    // Re-checked rather than trusted: an expired grant still reads as
    // isPremium until something looks at it, and a stale flag here would
    // hand out the paid cooldown for free.
    const fresh = user ? await ensurePremiumFresh(this.prisma, user) : null;
    const cooldownMs = fresh?.isPremium ? PIXEL_COOLDOWN_PREMIUM_MS : PIXEL_COOLDOWN_MS;
    if (!last) return { cooldownMs, remainingMs: 0 };

    const elapsed = Date.now() - last.createdAt.getTime();
    return { cooldownMs, remainingMs: Math.max(0, cooldownMs - elapsed) };
  }
}
