import { z } from 'zod';

/**
 * Pixel Battle — one shared canvas everybody paints on, a cell at a time.
 *
 * 250×250 rather than the 1000×1000 the format is famous for, and that is
 * the whole design. At one cell per person per cooldown, a canvas only fills
 * as fast as there are people: 1 000 000 cells would need roughly six years
 * of a hundred daily painters, and a canvas that can never fill is a canvas
 * nobody finishes anything on. 62 500 cells is a week or two of real
 * activity — small enough that a single drawing is visible from the first
 * day, big enough that it stays contested.
 */
export const PIXEL_CANVAS_SIZE = 250;
export const PIXEL_CELL_COUNT = PIXEL_CANVAS_SIZE * PIXEL_CANVAS_SIZE;

/** Between two of your own pixels. Premium's shorter wait is the point of paying. */
export const PIXEL_COOLDOWN_MS = 30 * 60 * 1000;
export const PIXEL_COOLDOWN_PREMIUM_MS = 10 * 60 * 1000;

/**
 * The palette, as a fixed list.
 *
 * Index 0 is "never painted" and is not offered in the UI — the snapshot is
 * served as one byte per cell, so a colour has to be an index into this
 * array, and free-form hex would make that impossible (and would also let
 * one person quietly paint the background colour over someone's work).
 */
export const PIXEL_EMPTY = 0;
export const PIXEL_PALETTE = [
  '#0f1311', // 0 — пусто
  '#ffffff',
  '#d4d7d9',
  '#898d90',
  '#000000',
  '#ff4500',
  '#ffa800',
  '#ffd635',
  '#00a368',
  '#4ade80',
  '#3690ea',
  '#51e9f4',
  '#2450a4',
  '#811e9f',
  '#b44ac0',
  '#ff99aa',
  '#9c6926',
] as const;

/** Human names, so the palette can be read by a screen reader and hinted on hover. */
export const PIXEL_PALETTE_NAMES = [
  'Пусто',
  'Белый',
  'Светло-серый',
  'Серый',
  'Чёрный',
  'Красный',
  'Оранжевый',
  'Жёлтый',
  'Зелёный',
  'Неоновый',
  'Синий',
  'Голубой',
  'Тёмно-синий',
  'Фиолетовый',
  'Сиреневый',
  'Розовый',
  'Коричневый',
] as const;

/** 1..16 — index 0 is the empty cell and can never be painted deliberately. */
export const PIXEL_MAX_COLOR = PIXEL_PALETTE.length - 1;

export const placePixelSchema = z.object({
  x: z.coerce.number().int().min(0).max(PIXEL_CANVAS_SIZE - 1),
  y: z.coerce.number().int().min(0).max(PIXEL_CANVAS_SIZE - 1),
  color: z.coerce.number().int().min(1).max(PIXEL_MAX_COLOR),
});
export type PlacePixelInput = z.infer<typeof placePixelSchema>;

export const pixelStateSchema = z.object({
  size: z.number().int().positive(),
  /** Milliseconds until this viewer may paint again; 0 means right now. */
  cooldownRemainingMs: z.number().int().nonnegative(),
  /** This viewer's full cooldown — Premium's is shorter, and the UI says so. */
  cooldownMs: z.number().int().positive(),
  /** How much of the canvas has ever been painted. */
  paintedCount: z.number().int().nonnegative(),
  /** People who placed at least one pixel in the last 24 hours. */
  activePainters: z.number().int().nonnegative(),
});
export type PixelState = z.infer<typeof pixelStateSchema>;

export const pixelPlacementSchema = z.object({
  color: z.number().int().min(0).max(PIXEL_MAX_COLOR),
  createdAt: z.string(),
  user: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});
export type PixelPlacement = z.infer<typeof pixelPlacementSchema>;

export const pixelCellSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  color: z.number().int().min(0).max(PIXEL_MAX_COLOR),
  /** Newest first. Empty for a cell nobody has touched. */
  history: z.array(pixelPlacementSchema),
});
export type PixelCell = z.infer<typeof pixelCellSchema>;

/** What the live stream pushes on every placement. */
export const pixelEventSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  color: z.number().int().min(1).max(PIXEL_MAX_COLOR),
});
export type PixelEvent = z.infer<typeof pixelEventSchema>;
