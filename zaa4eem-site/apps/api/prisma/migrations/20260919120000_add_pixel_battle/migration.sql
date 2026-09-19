-- Pixel Battle: the shared canvas and its placement log.
--
-- Additive only, like every migration here: nothing existing is altered
-- beyond one new defaulted column, so the currently-deployed API keeps
-- working against this schema for the whole deploy window.

-- One row per painted cell. (x, y) is the primary key, so painting an
-- already-painted cell is an upsert rather than a growing pile of rows.
CREATE TABLE "PixelCell" (
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "color" INTEGER NOT NULL,
    "painterId" TEXT,
    "paintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PixelCell_pkey" PRIMARY KEY ("x","y")
);

CREATE INDEX "PixelCell_paintedAt_idx" ON "PixelCell"("paintedAt");

ALTER TABLE "PixelCell" ADD CONSTRAINT "PixelCell_painterId_fkey"
    FOREIGN KEY ("painterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only history. Also what the per-user cooldown is measured against,
-- which is why (userId, createdAt) is indexed.
CREATE TABLE "PixelPlacement" (
    "id" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "color" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PixelPlacement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PixelPlacement_userId_createdAt_idx" ON "PixelPlacement"("userId", "createdAt");
CREATE INDEX "PixelPlacement_x_y_createdAt_idx" ON "PixelPlacement"("x", "y", "createdAt");
CREATE INDEX "PixelPlacement_createdAt_idx" ON "PixelPlacement"("createdAt");

ALTER TABLE "PixelPlacement" ADD CONSTRAINT "PixelPlacement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Feeds the "Холст" achievements, same shape as every other lifetime counter.
ALTER TABLE "UserProgress" ADD COLUMN "pixelsPainted" INTEGER NOT NULL DEFAULT 0;
