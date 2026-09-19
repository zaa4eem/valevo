-- Scrolls: the vertical video feed. Additive only — three new tables and one
-- new enum, nothing existing is touched, so the running API keeps working
-- against this schema for the whole deploy window.

CREATE TYPE "ScrollStatus" AS ENUM ('PROCESSING', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'FAILED');

CREATE TABLE "Scroll" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "posterUrl" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    -- PROCESSING by default: a row can only become visible by a moderator
    -- moving it, never by a code path forgetting to set this.
    "status" "ScrollStatus" NOT NULL DEFAULT 'PROCESSING',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Scroll_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Scroll_status_publishedAt_idx" ON "Scroll"("status", "publishedAt");
CREATE INDEX "Scroll_authorId_createdAt_idx" ON "Scroll"("authorId", "createdAt");

ALTER TABLE "Scroll" ADD CONSTRAINT "Scroll_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scroll" ADD CONSTRAINT "Scroll_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ScrollLike" (
    "scrollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrollLike_pkey" PRIMARY KEY ("scrollId","userId")
);

CREATE INDEX "ScrollLike_userId_idx" ON "ScrollLike"("userId");

ALTER TABLE "ScrollLike" ADD CONSTRAINT "ScrollLike_scrollId_fkey"
    FOREIGN KEY ("scrollId") REFERENCES "Scroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScrollLike" ADD CONSTRAINT "ScrollLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ScrollComment" (
    "id" TEXT NOT NULL,
    "scrollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrollComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScrollComment_scrollId_createdAt_idx" ON "ScrollComment"("scrollId", "createdAt");

ALTER TABLE "ScrollComment" ADD CONSTRAINT "ScrollComment_scrollId_fkey"
    FOREIGN KEY ("scrollId") REFERENCES "Scroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScrollComment" ADD CONSTRAINT "ScrollComment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
