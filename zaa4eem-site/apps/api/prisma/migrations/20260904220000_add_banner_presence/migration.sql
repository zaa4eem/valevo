-- Profile banner (Premium-only upload) + last-activity timestamp (presence indicator).
ALTER TABLE "User" ADD COLUMN "bannerUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
