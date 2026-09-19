import { PIXEL_CANVAS_SIZE, PIXEL_PALETTE } from '@zaa4eem/shared';

/**
 * The Pixel Battle canvas: pan, zoom and draw, with no framework in the
 * render path.
 *
 * The cells live in a Uint8Array and are painted into an offscreen
 * 250×250 bitmap — one real pixel per cell. Everything the viewer sees is
 * that bitmap scaled up with smoothing off, so a placement is a single
 * 4-byte write plus a `drawImage`, and zooming costs nothing at all. Drawing
 * 62 500 rectangles instead would make a phone crawl at any zoom level.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 40;

type Point = { x: number; y: number };

export interface PixelEngineOptions {
  canvas: HTMLCanvasElement;
  onViewChange?: (scale: number) => void;
}

/** Palette entries as [r, g, b], parsed once instead of per pixel. */
const RGB = PIXEL_PALETTE.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

export class PixelEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** One byte per cell, row-major — the same layout the API's snapshot uses. */
  private cells = new Uint8Array(PIXEL_CANVAS_SIZE * PIXEL_CANVAS_SIZE);
  private bitmap: HTMLCanvasElement;
  private bitmapCtx: CanvasRenderingContext2D;
  private imageData: ImageData;

  private scale = 3;
  private offset: Point = { x: 0, y: 0 };
  private dpr = 1;
  private selected: Point | null = null;
  /** Drawn under the cursor before it is committed, so a mis-tap costs nothing. */
  private preview: number | null = null;
  private onViewChange?: (scale: number) => void;
  private frame: number | null = null;

  constructor(opts: PixelEngineOptions) {
    this.canvas = opts.canvas;
    this.onViewChange = opts.onViewChange;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.bitmap = document.createElement('canvas');
    this.bitmap.width = PIXEL_CANVAS_SIZE;
    this.bitmap.height = PIXEL_CANVAS_SIZE;
    const bitmapCtx = this.bitmap.getContext('2d');
    if (!bitmapCtx) throw new Error('Canvas 2D context unavailable');
    this.bitmapCtx = bitmapCtx;
    this.imageData = this.bitmapCtx.createImageData(PIXEL_CANVAS_SIZE, PIXEL_CANVAS_SIZE);

    this.repaintBitmap();
  }

  /** Replaces the whole canvas — the snapshot the page loads with. */
  setSnapshot(bytes: Uint8Array) {
    this.cells.set(bytes.subarray(0, this.cells.length));
    this.repaintBitmap();
    this.render();
  }

  /** One cell, from the live stream or from the viewer's own placement. */
  setCell(x: number, y: number, color: number) {
    if (x < 0 || y < 0 || x >= PIXEL_CANVAS_SIZE || y >= PIXEL_CANVAS_SIZE) return;
    this.cells[y * PIXEL_CANVAS_SIZE + x] = color;
    this.writePixel(x, y, color);
    this.bitmapCtx.putImageData(this.imageData, 0, 0);
    this.render();
  }

  colorAt(x: number, y: number): number {
    return this.cells[y * PIXEL_CANVAS_SIZE + x] ?? 0;
  }

  getSelected(): Point | null {
    return this.selected;
  }

  select(cell: Point | null) {
    this.selected = cell;
    this.render();
  }

  setPreview(color: number | null) {
    this.preview = color;
    this.render();
  }

  getScale() {
    return this.scale;
  }

  /**
   * Sizes the backing store to the element's real size in device pixels.
   *
   * Called on mount and from a ResizeObserver: a canvas whose backing store
   * doesn't match its CSS size renders a blurry, offset picture, and here
   * that would also throw off every screen→cell hit test.
   */
  resize(cssWidth: number, cssHeight: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.max(1, Math.round(cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * this.dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.clampOffset();
    this.render();
  }

  /** Fits the whole canvas into the viewport and centres it. */
  fit() {
    const { width, height } = this.viewportSize();
    this.scale = Math.max(MIN_SCALE, Math.min(width, height) / PIXEL_CANVAS_SIZE);
    this.offset = {
      x: (width - PIXEL_CANVAS_SIZE * this.scale) / 2,
      y: (height - PIXEL_CANVAS_SIZE * this.scale) / 2,
    };
    this.onViewChange?.(this.scale);
    this.render();
  }

  /** Centres a cell and zooms in enough to aim at it — used by "найти мой пиксель" and deep links. */
  focusCell(x: number, y: number, scale = 16) {
    const { width, height } = this.viewportSize();
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    this.offset = {
      x: width / 2 - (x + 0.5) * this.scale,
      y: height / 2 - (y + 0.5) * this.scale,
    };
    this.clampOffset();
    this.onViewChange?.(this.scale);
    this.render();
  }

  panBy(dx: number, dy: number) {
    this.offset = { x: this.offset.x + dx, y: this.offset.y + dy };
    this.clampOffset();
    this.render();
  }

  /**
   * Zooms around a fixed screen point.
   *
   * Keeping the cell under the cursor (or under the pinch centre) in place
   * is what makes zoom feel like moving a map rather than like a slider —
   * it's also the only way to aim at a cell on a phone.
   */
  zoomAt(screen: Point, factor: number) {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    if (next === this.scale) return;
    const ratio = next / this.scale;
    this.offset = {
      x: screen.x - (screen.x - this.offset.x) * ratio,
      y: screen.y - (screen.y - this.offset.y) * ratio,
    };
    this.scale = next;
    this.clampOffset();
    this.onViewChange?.(this.scale);
    this.render();
  }

  /** Screen coordinates (relative to the canvas element) → cell, or null outside the canvas. */
  cellAt(screen: Point): Point | null {
    const x = Math.floor((screen.x - this.offset.x) / this.scale);
    const y = Math.floor((screen.y - this.offset.y) / this.scale);
    if (x < 0 || y < 0 || x >= PIXEL_CANVAS_SIZE || y >= PIXEL_CANVAS_SIZE) return null;
    return { x, y };
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private viewportSize() {
    return { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr };
  }

  /**
   * Never lets the canvas be dragged fully out of view.
   *
   * When the canvas is smaller than the viewport it is centred instead of
   * clamped — otherwise a zoomed-out canvas would stick to the top-left
   * corner the moment you nudged it.
   */
  private clampOffset() {
    const { width, height } = this.viewportSize();
    const drawn = PIXEL_CANVAS_SIZE * this.scale;
    const margin = Math.min(width, height) / 4;

    if (drawn <= width) this.offset.x = (width - drawn) / 2;
    else this.offset.x = Math.min(margin, Math.max(width - drawn - margin, this.offset.x));

    if (drawn <= height) this.offset.y = (height - drawn) / 2;
    else this.offset.y = Math.min(margin, Math.max(height - drawn - margin, this.offset.y));
  }

  private writePixel(x: number, y: number, color: number) {
    const [r, g, b] = RGB[color] ?? RGB[0];
    const i = (y * PIXEL_CANVAS_SIZE + x) * 4;
    this.imageData.data[i] = r;
    this.imageData.data[i + 1] = g;
    this.imageData.data[i + 2] = b;
    this.imageData.data[i + 3] = 255;
  }

  private repaintBitmap() {
    for (let y = 0; y < PIXEL_CANVAS_SIZE; y += 1) {
      for (let x = 0; x < PIXEL_CANVAS_SIZE; x += 1) {
        this.writePixel(x, y, this.cells[y * PIXEL_CANVAS_SIZE + x]);
      }
    }
    this.bitmapCtx.putImageData(this.imageData, 0, 0);
  }

  /** Coalesced into one animation frame — a burst of stream events must not mean a burst of repaints. */
  private render() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private draw() {
    const { ctx } = this;
    const { width, height } = this.viewportSize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#080a09';
    ctx.fillRect(0, 0, width, height);

    // Nearest-neighbour: a pixel canvas that gets bilinear-smoothed on zoom
    // stops being a pixel canvas.
    ctx.imageSmoothingEnabled = false;
    const drawn = PIXEL_CANVAS_SIZE * this.scale;
    ctx.drawImage(this.bitmap, this.offset.x, this.offset.y, drawn, drawn);

    // A hairline border, so the edge of the canvas is visible against the page.
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.offset.x - 0.5, this.offset.y - 0.5, drawn + 1, drawn + 1);

    // A grid, but only once cells are big enough that it reads as a grid
    // instead of as noise over the picture.
    if (this.scale >= 8) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      const firstX = Math.max(0, Math.floor(-this.offset.x / this.scale));
      const lastX = Math.min(PIXEL_CANVAS_SIZE, Math.ceil((width - this.offset.x) / this.scale));
      const firstY = Math.max(0, Math.floor(-this.offset.y / this.scale));
      const lastY = Math.min(PIXEL_CANVAS_SIZE, Math.ceil((height - this.offset.y) / this.scale));
      for (let x = firstX; x <= lastX; x += 1) {
        const px = Math.round(this.offset.x + x * this.scale) + 0.5;
        ctx.moveTo(px, this.offset.y);
        ctx.lineTo(px, this.offset.y + drawn);
      }
      for (let y = firstY; y <= lastY; y += 1) {
        const py = Math.round(this.offset.y + y * this.scale) + 0.5;
        ctx.moveTo(this.offset.x, py);
        ctx.lineTo(this.offset.x + drawn, py);
      }
      ctx.stroke();
    }

    if (this.selected) {
      const sx = this.offset.x + this.selected.x * this.scale;
      const sy = this.offset.y + this.selected.y * this.scale;

      if (this.preview !== null) {
        ctx.fillStyle = PIXEL_PALETTE[this.preview] ?? PIXEL_PALETTE[0];
        ctx.fillRect(sx, sy, this.scale, this.scale);
      }

      // Two strokes, dark under light: a single-colour cursor disappears
      // against whichever colour happens to be under it.
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeRect(sx - 1.5, sy - 1.5, this.scale + 3, this.scale + 3);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(sx - 1.5, sy - 1.5, this.scale + 3, this.scale + 3);
    }
  }
}
