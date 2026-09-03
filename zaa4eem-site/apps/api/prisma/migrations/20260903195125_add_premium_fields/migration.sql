-- CreateEnum
CREATE TYPE "PremiumNameStyle" AS ENUM ('FLOW', 'HOLO', 'GLOW');

-- CreateEnum
CREATE TYPE "PremiumRingStyle" AS ENUM ('SPIN', 'PULSE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "badgeEmoji" TEXT,
ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nameColor" TEXT,
ADD COLUMN     "nameStyle" "PremiumNameStyle",
ADD COLUMN     "ringStyle" "PremiumRingStyle";
