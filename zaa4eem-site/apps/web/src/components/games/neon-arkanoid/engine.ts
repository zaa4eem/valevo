// Framework-free Neon Arkanoid engine — a plain <canvas> game loop with no
// React in the render path, same shape as SnakeEngine so it works unchanged
// inside the Telegram WebView.

export interface ArkanoidEngineOptions {
  canvas: HTMLCanvasElement;
  onScoreChange?: (score: number) => void;
  onLivesChange?: (lives: number) => void;
  onLevelChange?: (level: number) => void;
  onGameOver?: (finalScore: number) => void;
}

/**
 * The playfield, in logical units.
 *
 * Every number below is in this space, and the canvas only ever scales it —
 * the same decision as the snake's fixed 20×20 grid, and for the same
 * reason: scores go on one shared leaderboard, so the game has to be the
 * same game on a 360px phone and a 27" monitor. A playfield that grew with
 * the screen would hand desktop players a wider paddle and more reaction
 * time for free.
 */
const W = 100;
const H = 130;

const PADDLE_W = 18;
const PADDLE_H = 2.4;
const PADDLE_Y = H - 8;
const BALL_R = 1.4;

const COLS = 10;
const BRICK_H = 4;
const BRICK_GAP = 0.6;
const BRICK_TOP = 12;
/** Rows on level 1; grows with the level up to MAX_ROWS. */
const START_ROWS = 4;
const MAX_ROWS = 8;

/**
 * Ball speed, in playfield units per second.
 *
 * Tuned against the field, not guessed: the gap from the paddle to the
 * bricks is about 90 units, so 65 is a ~1.4s trip up and back down. At the
 * 46 it started at, a round trip took four seconds and the game felt like
 * waiting rather than playing.
 */
const START_SPEED = 65;
const SPEED_PER_LEVEL = 6;
/** Every few hits the rally speeds up, so a long rally gets harder rather than safer. */
const SPEED_PER_HIT = 0.5;
const MAX_SPEED = 120;

const START_LIVES = 3;
const BRICK_POINTS = 10;
const LEVEL_BONUS = 100;

/**
 * Physics runs on this fixed step regardless of frame rate.
 *
 * Without it the ball would move a screen-refresh's worth per frame, making
 * the game literally twice as fast on a 120Hz phone as on a 60Hz laptop —
 * and the leaderboard would be measuring hardware.
 */
const STEP_MS = 1000 / 120;
/** After a tab has been hidden, don't simulate the whole gap at once. */
const MAX_CATCHUP_MS = 250;

type Brick = { x: number; y: number; w: number; h: number; hp: number; tone: number };

/** Row colours, top row hardest. */
const TONES = ['#f472b6', '#f87171', '#fbbf24', '#4ade80', '#38bdf8', '#a78bfa', '#2dd4bf', '#94a3b8'];

export class ArkanoidEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 3;
  private dpr = 1;

  private paddleX = W / 2;
  private ball = { x: W / 2, y: PADDLE_Y - BALL_R - 0.2, vx: 0, vy: 0 };
  private bricks: Brick[] = [];
  private score = 0;
  private lives = START_LIVES;
  private level = 1;
  private speed = START_SPEED;
  private hits = 0;
  /** The ball rides the paddle until the player launches it. */
  private stuck = true;
  private running = false;
  private frame: number | null = null;
  private lastTime = 0;
  private accumulator = 0;

  private onScoreChange?: (score: number) => void;
  private onLivesChange?: (lives: number) => void;
  private onLevelChange?: (level: number) => void;
  private onGameOver?: (finalScore: number) => void;

  constructor(opts: ArkanoidEngineOptions) {
    this.canvas = opts.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.onScoreChange = opts.onScoreChange;
    this.onLivesChange = opts.onLivesChange;
    this.onLevelChange = opts.onLevelChange;
    this.onGameOver = opts.onGameOver;

    this.reset();
  }

  /** Logical playfield size, so the component can keep the canvas' aspect ratio. */
  static get aspect() {
    return W / H;
  }

  reset() {
    this.score = 0;
    this.lives = START_LIVES;
    this.level = 1;
    this.speed = START_SPEED;
    this.hits = 0;
    this.buildLevel();
    this.resetBall();
    this.onScoreChange?.(this.score);
    this.onLivesChange?.(this.lives);
    this.onLevelChange?.(this.level);
    this.draw();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** Launches the ball off the paddle — the same action on tap, click and space. */
  launch() {
    if (!this.stuck) return;
    this.stuck = false;
    // Always upward, angled by where the paddle is, so the opening shot
    // isn't identical every round. A dead-centre paddle would otherwise
    // launch dead vertical, which setVelocity refuses.
    const drift = (this.paddleX - W / 2) / (W / 2);
    this.setVelocity(-Math.PI / 2 + drift * 0.5, this.speed);
  }

  /**
   * Sets the ball's velocity from an angle, never perfectly vertical.
   *
   * A ball with no horizontal speed bounces up and down the same column
   * forever: the paddle sends it back exactly where it came from, so a
   * player who simply stops moving can leave a round running indefinitely.
   * Nudging the angle off vertical costs nothing in feel and makes that
   * state unreachable.
   */
  private setVelocity(angle: number, speed: number) {
    const MIN_TILT = 0.12; // radians away from straight up or straight down
    const fromVertical = Math.abs(Math.abs(angle) - Math.PI / 2);
    let corrected = angle;
    if (fromVertical < MIN_TILT) {
      const sign = Math.cos(angle) >= 0 ? 1 : -1;
      corrected = angle + sign * (MIN_TILT - fromVertical);
    }
    this.ball.vx = Math.cos(corrected) * speed;
    this.ball.vy = Math.sin(corrected) * speed;
  }

  /** Moves the paddle to a logical x, clamped to the playfield. */
  movePaddleTo(x: number) {
    this.paddleX = Math.max(PADDLE_W / 2, Math.min(W - PADDLE_W / 2, x));
    if (this.stuck) {
      this.ball.x = this.paddleX;
      this.draw();
    }
  }

  /** Nudges the paddle — keyboard control, in logical units. */
  nudgePaddle(dx: number) {
    this.movePaddleTo(this.paddleX + dx);
  }

  /** Converts a point in CSS pixels on the canvas to a logical x. */
  toLogicalX(cssX: number) {
    return cssX / this.scale;
  }

  /**
   * Sizes the canvas from the width it is given, keeping the playfield's
   * aspect ratio and sharpening the backing store for the display's pixel
   * density.
   */
  resize(cssWidth: number) {
    this.scale = cssWidth / W;
    this.dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3);
    const cssHeight = H * this.scale;

    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    // Assigning width/height clears the context, so the transform goes on
    // after. Everything below then draws in logical units and knows nothing
    // about pixels.
    this.ctx.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, 0, 0);
    this.draw();
  }

  getScore() {
    return this.score;
  }

  private buildLevel() {
    const rows = Math.min(MAX_ROWS, START_ROWS + Math.floor((this.level - 1) / 2));
    const brickW = (W - BRICK_GAP * (COLS + 1)) / COLS;
    this.bricks = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        // From level 3 on, some bricks take two hits — the level gets harder
        // by needing more of them, not by adding yet another row of one-hit
        // bricks.
        const tough = this.level >= 3 && (row + col) % 4 === 0;
        this.bricks.push({
          x: BRICK_GAP + col * (brickW + BRICK_GAP),
          y: BRICK_TOP + row * (BRICK_H + BRICK_GAP),
          w: brickW,
          h: BRICK_H,
          hp: tough ? 2 : 1,
          tone: row % TONES.length,
        });
      }
    }
  }

  private resetBall() {
    this.stuck = true;
    this.hits = 0;
    this.paddleX = W / 2;
    this.ball = { x: W / 2, y: PADDLE_Y - BALL_R - 0.2, vx: 0, vy: 0 };
  }

  private loop() {
    if (!this.running) return;
    this.frame = requestAnimationFrame(() => {
      const now = performance.now();
      // Clamped, so coming back to a backgrounded tab doesn't teleport the
      // ball through the bricks in one enormous step.
      this.accumulator += Math.min(MAX_CATCHUP_MS, now - this.lastTime);
      this.lastTime = now;
      while (this.accumulator >= STEP_MS) {
        this.step(STEP_MS / 1000);
        this.accumulator -= STEP_MS;
        if (!this.running) break;
      }
      this.draw();
      this.loop();
    });
  }

  private step(dt: number) {
    if (this.stuck) return;

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;

    // Walls. Position is corrected as well as velocity, or a ball that
    // arrives fast enough to overshoot can get stuck vibrating in the wall.
    if (this.ball.x - BALL_R < 0) {
      this.ball.x = BALL_R;
      this.ball.vx = Math.abs(this.ball.vx);
    } else if (this.ball.x + BALL_R > W) {
      this.ball.x = W - BALL_R;
      this.ball.vx = -Math.abs(this.ball.vx);
    }
    if (this.ball.y - BALL_R < 0) {
      this.ball.y = BALL_R;
      this.ball.vy = Math.abs(this.ball.vy);
    }

    this.bouncePaddle();
    this.hitBricks();

    if (this.ball.y - BALL_R > H) this.loseLife();
  }

  private bouncePaddle() {
    const left = this.paddleX - PADDLE_W / 2;
    const right = this.paddleX + PADDLE_W / 2;
    const top = PADDLE_Y;

    const overlaps =
      this.ball.vy > 0 &&
      this.ball.y + BALL_R >= top &&
      this.ball.y - BALL_R <= top + PADDLE_H &&
      this.ball.x >= left - BALL_R &&
      this.ball.x <= right + BALL_R;
    if (!overlaps) return;

    // Where on the paddle it landed sets the angle — that is the whole skill
    // of the game, and a pure mirror bounce would remove it.
    const offset = (this.ball.x - this.paddleX) / (PADDLE_W / 2);
    const angle = -Math.PI / 2 + Math.max(-1, Math.min(1, offset)) * (Math.PI / 3);
    this.hits += 1;
    const speed = Math.min(MAX_SPEED, this.speed + this.hits * SPEED_PER_HIT);
    this.setVelocity(angle, speed);
    this.ball.y = top - BALL_R;
  }

  private hitBricks() {
    for (let i = 0; i < this.bricks.length; i += 1) {
      const brick = this.bricks[i];
      if (
        this.ball.x + BALL_R < brick.x ||
        this.ball.x - BALL_R > brick.x + brick.w ||
        this.ball.y + BALL_R < brick.y ||
        this.ball.y - BALL_R > brick.y + brick.h
      ) {
        continue;
      }

      // Which face was hit, from how far the ball has penetrated the side it
      // could actually have come through.
      //
      // Taking the smaller of both edges regardless of direction is the
      // usual shortcut, and it is wrong in exactly the case this game hits
      // constantly: a ball rising straight up (vx = 0) grazes a brick's
      // side, "bounces" on X — which does nothing at all to a zero
      // horizontal speed — and sails on through the brick. A face the ball
      // is not travelling towards is not a face it can hit, so it scores
      // Infinity and never wins the comparison.
      const penX =
        this.ball.vx > 0
          ? this.ball.x + BALL_R - brick.x
          : this.ball.vx < 0
            ? brick.x + brick.w - (this.ball.x - BALL_R)
            : Infinity;
      const penY =
        this.ball.vy > 0
          ? this.ball.y + BALL_R - brick.y
          : this.ball.vy < 0
            ? brick.y + brick.h - (this.ball.y - BALL_R)
            : Infinity;

      // Pushed back out as well as reflected: leaving the ball inside the
      // brick lets the next step find the same overlap and flip the velocity
      // straight back.
      if (penX <= penY) {
        this.ball.x += this.ball.vx > 0 ? -penX : penX;
        this.ball.vx = -this.ball.vx;
      } else {
        this.ball.y += this.ball.vy > 0 ? -penY : penY;
        this.ball.vy = -this.ball.vy;
      }

      brick.hp -= 1;
      if (brick.hp <= 0) {
        this.bricks.splice(i, 1);
        this.score += BRICK_POINTS;
        this.onScoreChange?.(this.score);
      }

      if (this.bricks.length === 0) this.nextLevel();
      // One brick per step: a single frame hitting two bricks would flip the
      // velocity twice and send the ball straight back through the wall.
      return;
    }
  }

  private nextLevel() {
    this.score += LEVEL_BONUS * this.level;
    this.level += 1;
    this.speed = Math.min(MAX_SPEED, START_SPEED + (this.level - 1) * SPEED_PER_LEVEL);
    this.onScoreChange?.(this.score);
    this.onLevelChange?.(this.level);
    this.buildLevel();
    this.resetBall();
  }

  private loseLife() {
    this.lives -= 1;
    this.onLivesChange?.(this.lives);
    if (this.lives <= 0) {
      this.stop();
      this.onGameOver?.(this.score);
      return;
    }
    this.resetBall();
  }

  private draw() {
    const { ctx } = this;
    ctx.fillStyle = '#0b0e0d';
    ctx.fillRect(0, 0, W, H);

    for (const brick of this.bricks) {
      const tone = TONES[brick.tone] ?? TONES[0];
      ctx.fillStyle = brick.hp > 1 ? tone : `${tone}bb`;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      // A two-hit brick reads as armoured rather than just a different
      // shade, so the player can see what still needs a second hit.
      if (brick.hp > 1) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.4;
        ctx.strokeRect(brick.x + 0.4, brick.y + 0.4, brick.w - 0.8, brick.h - 0.8);
      }
    }

    ctx.fillStyle = '#4ade80';
    ctx.fillRect(this.paddleX - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H);

    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}
