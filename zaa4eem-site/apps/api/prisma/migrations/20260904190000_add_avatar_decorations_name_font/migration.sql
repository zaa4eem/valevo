-- AlterEnum
ALTER TYPE "PremiumRingStyle" ADD VALUE 'GLOW';
ALTER TYPE "PremiumRingStyle" ADD VALUE 'RAINBOW';
ALTER TYPE "PremiumRingStyle" ADD VALUE 'VENOM';

-- CreateEnum
CREATE TYPE "PremiumNameFont" AS ENUM ('SPACE', 'SERIF', 'PIXEL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "nameFont" "PremiumNameFont";
