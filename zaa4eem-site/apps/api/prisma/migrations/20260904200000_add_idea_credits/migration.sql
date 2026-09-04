-- CreateTable
CREATE TABLE "IdeaCredit" (
    "id" TEXT NOT NULL,
    "creditedId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdeaCredit_creditedId_idx" ON "IdeaCredit"("creditedId");

-- AddForeignKey
ALTER TABLE "IdeaCredit" ADD CONSTRAINT "IdeaCredit_creditedId_fkey" FOREIGN KEY ("creditedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
