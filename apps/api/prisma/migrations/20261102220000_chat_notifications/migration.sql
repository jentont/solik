-- AlterTable
ALTER TABLE "BotUser" ADD COLUMN "notify" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ChatAudience" (
    "botId" TEXT NOT NULL,
    "chatTgId" BIGINT NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAudience_pkey" PRIMARY KEY ("botId","chatTgId","tgUserId")
);

-- CreateIndex
CREATE INDEX "ChatAudience_botId_chatTgId_lastSeenAt_idx" ON "ChatAudience"("botId", "chatTgId", "lastSeenAt");
