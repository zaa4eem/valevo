-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "premiumUntil" TIMESTAMP(3),
ADD COLUMN     "usedTrialPremium" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every existing row needs a code before the column can become
-- NOT NULL + UNIQUE. Random rather than derived from memberNumber on
-- purpose — a sequential/guessable code would leak the user count and
-- invite enumeration.
UPDATE "User" SET "referralCode" = upper(substr(md5(random()::text || "id"), 1, 7)) WHERE "referralCode" IS NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_invitedById_idx" ON "User"("invitedById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PendingReferral" (
    "telegramId" BIGINT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingReferral_pkey" PRIMARY KEY ("telegramId")
);

-- AddForeignKey
ALTER TABLE "PendingReferral" ADD CONSTRAINT "PendingReferral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
