// Framework-free Neon Snake engine — a plain <canvas> game loop with no
// React/DOM framework dependency, so it is trivially reusable inside the
// Telegram WebView too (research.md §5).

export interface SnakeEngineOptions {
  canvas: HTMLCanvasElement;
  cellSize?: number;
  cols?: number;
  rows?: number;
  onScoreChange?: (score: number) => void;
  onGameOver?: (finalScore: number) => void;
}

type Point = { x: number; y: number };
type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

const OPPOSITE: Record<Direction, Direction> = {
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT',
};

const TICK_MS_START = 140;
const TICK_MS_MIN = 70;

export class SnakeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cellSize: number;
  private cols: number;
  private rows: number;

  private snake: Point[] = [];
  private direction: Direction = 'RIGHT';
  private queuedDirection: Direction = 'RIGHT';
  private food: Point = { x: 0, y: 0 };
  private score = 0;
  private tickMs = TICK_MS_START;
  private loopHandle: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private onScoreChange?: (score: number) => void;
  private onGameOver?: (finalScore: number) => void;

  constructor(opts: SnakeEngineOptions) {
    this.canvas = opts.canvas;
    this.cellSize = opts.cellSize ?? 18;
    this.cols = opts.cols ?? 20;
    this.rows = opts.rows ?? 20;
    this.onScoreChange = opts.onScoreChange;
    this.onGameOver = opts.onGameOver;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.reset();
    this.resize(this.cellSize);
  }

  /**
   * Re-sizes the board for a given cell size.
   *
   * The grid stays cols×rows on every device — only how many pixels a cell
   * takes changes. That is deliberate and not negotiable: scores go onto a
   * shared leaderboard, so the playfield has to be the same number of cells
   * whether you're on a 360px phone or a desktop, or the board would be
   * comparing different games.
   *
   * The backing store is sized in device pixels and the context scaled to
   * match, so the board is crisp on a phone instead of an upscaled blur.
   */
  resize(cellSize: number) {
    this.cellSize = cellSize;

    const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3);
    const cssWidth = this.cols * cellSize;
    const cssHeight = this.rows * cellSize;

    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // Assigning width/height clears the context state, so the transform has
    // to be (re)applied after, not before. draw() then keeps working in
    // plain cell coordinates and knows nothing about pixel density.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  reset() {
    const midX = Math.floor(this.cols / 2);
    const midY = Math.floor(this.rows / 2);
    this.snake = [
      { x: midX - 1, y: midY },
      { x: midX - 2, y: midY },
      { x: midX - 3, y: midY },
    ];
    this.direction = 'RIGHT';
    this.queuedDirection = 'RIGHT';
    this.score = 0;
    this.tickMs = TICK_MS_START;
    this.placeFood();
    this.draw();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scheduleTick();
  }

  stop() {
    this.running = false;
    if (this.loopHandle) clearTimeout(this.loopHandle);
  }

  setDirection(dir: Direction) {
    if (OPPOSITE[dir] === this.direction) return; // no 180° reversals
    this.queuedDirection = dir;
  }

  private scheduleTick() {
    if (!this.running) return;
    this.loopHandle = setTimeout(() => {
      this.tick();
      this.scheduleTick();
    }, this.tickMs);
  }

  private placeFood() {
    let candidate: Point;
    do {
      candidate = {
        x: Math.floor(Math.random() * this.cols),
        y: Math.floor(Math.random() * this.rows),
      };
    } while (this.snake.some((s) => s.x === candidate.x && s.y === candidate.y));
    this.food = candidate;
  }

  private tick() {
    this.direction = this.queuedDirection;
    const head = this.snake[0];
    const next: Point = { ...head };
    if (this.direction === 'UP') next.y -= 1;
    if (this.direction === 'DOWN') next.y += 1;
    if (this.direction === 'LEFT') next.x -= 1;
    if (this.direction === 'RIGHT') next.x += 1;

    const hitsWall = next.x < 0 || next.x >= this.cols || next.y < 0 || next.y >= this.rows;
    const hitsSelf = this.snake.some((s) => s.x === next.x && s.y === next.y);

    if (hitsWall || hitsSelf) {
      this.stop();
      this.onGameOver?.(this.score);
      return;
    }

    this.snake.unshift(next);

    if (next.x === this.food.x && next.y === this.food.y) {
      this.score += 1;
      this.onScoreChange?.(this.score);
      this.tickMs = Math.max(TICK_MS_MIN, TICK_MS_START - this.score * 3);
      this.placeFood();
    } else {
      this.snake.pop();
    }

    this.draw();
  }

  private draw() {
    const { ctx, cellSize, cols, rows } = this;
    ctx.fillStyle = '#0b0e0d';
    ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

    ctx.fillStyle = '#f87171';
    ctx.fillRect(
      this.food.x * cellSize + 2,
      this.food.y * cellSize + 2,
      cellSize - 4,
      cellSize - 4,
    );

    this.snake.forEach((segment, i) => {
      ctx.fillStyle = i === 0 ? '#4ade80' : 'rgba(74, 222, 128, 0.75)';
      ctx.fillRect(
        segment.x * cellSize + 1,
        segment.y * cellSize + 1,
        cellSize - 2,
        cellSize - 2,
      );
    });
  }

  getScore() {
    return this.score;
  }
}
