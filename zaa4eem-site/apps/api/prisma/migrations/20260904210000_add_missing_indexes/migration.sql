-- CreateIndex
CREATE INDEX "User_zCoins_idx" ON "User"("zCoins");

-- CreateIndex
CREATE INDEX "Follow_followingId_createdAt_id_idx" ON "Follow"("followingId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Follow_followerId_createdAt_id_idx" ON "Follow"("followerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Idea_moderationState_voteCount_idx" ON "Idea"("moderationState", "voteCount");

-- CreateIndex
CREATE INDEX "Idea_moderationState_createdAt_idx" ON "Idea"("moderationState", "createdAt");

-- CreateIndex
CREATE INDEX "Score_gameId_reviewState_value_idx" ON "Score"("gameId", "reviewState", "value");

-- CreateIndex
CREATE INDEX "Score_userId_reviewState_idx" ON "Score"("userId", "reviewState");

-- CreateIndex
CREATE INDEX "ModerationLogEntry_createdAt_idx" ON "ModerationLogEntry"("createdAt");
