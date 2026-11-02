-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('ACTIVE', 'DISABLED', 'SUSPENDED', 'SUBSCRIPTION_EXPIRED', 'INVALID_TOKEN');

-- CreateEnum
CREATE TYPE "ChatKind" AS ENUM ('GROUP', 'SUPERGROUP');

-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BOT_REMOVED', 'BOT_RESTRICTED', 'PERMISSION_MISSING', 'DISCONNECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ContestType" AS ENUM ('RANDOM', 'STARS_AUCTION', 'FIRST_COMMENT', 'SMS_COUNTER', 'MESSAGE_GIVEAWAY', 'ACTIVITY', 'GIFTS', 'NFT', 'DICE_777');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'DRAWING', 'FINISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PrizeKind" AS ENUM ('GIFT', 'STARS', 'NFT', 'PREMIUM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WinnerStatus" AS ENUM ('ACTIVE', 'REROLLED');

-- CreateEnum
CREATE TYPE "SmsMode" AS ENUM ('FIRST_N_USERS', 'FIRST_N_MESSAGES', 'EVERY_NTH', 'FIRST_COMMENT');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('ACTIVE', 'FILLED', 'STOPPED', 'FINISHED');

-- CreateEnum
CREATE TYPE "GiftType" AS ENUM ('REGULAR', 'LIMITED', 'COLLECTIBLE', 'REMOVED', 'NFT');

-- CreateEnum
CREATE TYPE "GiftAvailability" AS ENUM ('AVAILABLE', 'SOLD_OUT', 'REMOVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'MANUAL_REQUIRED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('BOT_SEND_GIFT', 'BUSINESS_TRANSFER', 'PREMIUM_GIFT', 'NFT_PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "StarsTxStatus" AS ENUM ('PENDING', 'PAID', 'APPLIED', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "NftStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "TemplateKey" AS ENUM ('CONTEST_START', 'PARTICIPANT_REGISTERED', 'WINNER', 'LOSER', 'GIFT_RECEIVED', 'CONTEST_FINISHED', 'ERROR', 'SMS_STARTED', 'SMS_REGISTERED', 'SMS_FILLED', 'RESULTS', 'AUCTION_BID', 'AUCTION_FINISHED', 'AUCTION_WARNING', 'AUCTION_COUNTDOWN', 'INSTANT_WIN', 'CHANCE_WIN', 'DICE_WIN', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'ANIMATION', 'VIDEO');

-- CreateEnum
CREATE TYPE "AIJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "BotSubStatus" AS ENUM ('PENDING', 'ACTIVE', 'GRACE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BroadcastMode" AS ENUM ('ALL_CHATS', 'WHITE_LABEL_CHATS', 'MAIN_BOT_CHATS', 'MAIN_BOT_USERS');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'STOPPED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BLOCKED', 'PERMISSION_LOST', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "photoUrl" TEXT,
    "languageCode" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramBot" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'ACTIVE',
    "canReadAll" BOOLEAN NOT NULL DEFAULT false,
    "defaultPrizeId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT,
    "shortDescription" TEXT,
    "welcomeText" TEXT,
    "welcomeMediaId" TEXT,
    "menuButtons" JSONB NOT NULL DEFAULT '[]',
    "commands" JSONB NOT NULL DEFAULT '[]',
    "avatarMediaId" TEXT,
    "lastError" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramChat" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "ownerId" TEXT,
    "chatId" BIGINT NOT NULL,
    "kind" "ChatKind" NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "status" "ChatStatus" NOT NULL DEFAULT 'ACTIVE',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "memberCount" INTEGER,
    "messagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "linkedChannelChatId" BIGINT,
    "lastActivityAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramChannel" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "ownerId" TEXT,
    "chatId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "status" "ChatStatus" NOT NULL DEFAULT 'ACTIVE',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "canPost" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "memberCount" INTEGER,
    "postsProcessed" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discussionChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPost" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "text" TEXT,
    "discussionMessageId" INTEGER,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramBusinessConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "botId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "userChatId" BIGINT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rights" JSONB NOT NULL DEFAULT '{}',
    "canViewGifts" BOOLEAN NOT NULL DEFAULT false,
    "canTransferGifts" BOOLEAN NOT NULL DEFAULT false,
    "canTransferStars" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBusinessConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessOwnedGift" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "ownedGiftId" TEXT NOT NULL,
    "telegramGiftId" TEXT,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "canBeTransferred" BOOLEAN NOT NULL DEFAULT false,
    "transferStarCount" INTEGER,
    "reservedForPrizeId" TEXT,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessOwnedGift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "chatId" TEXT,
    "channelId" TEXT,
    "type" "ContestType" NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "winnersCount" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "postText" TEXT,
    "postMediaId" TEXT,
    "postButtons" JSONB,
    "targetChatTgId" BIGINT,
    "publishedMessageId" INTEGER,
    "threadMessageId" INTEGER,
    "timerVersion" INTEGER NOT NULL DEFAULT 0,
    "currentBid" INTEGER,
    "leaderTgId" BIGINT,
    "leaderName" TEXT,
    "bidsCount" INTEGER NOT NULL DEFAULT 0,
    "messageCounter" INTEGER NOT NULL DEFAULT 0,
    "drawsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestPrize" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "kind" "PrizeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "giftId" TEXT,
    "nftAssetId" TEXT,
    "businessOwnedGiftId" TEXT,
    "starsAmount" INTEGER,
    "premiumMonths" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "place" INTEGER,
    "position" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestPrize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestParticipant" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "position" INTEGER,
    "score" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastTextHash" TEXT,
    "isEligible" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestWinner" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "participantId" TEXT,
    "tgUserId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "place" INTEGER NOT NULL,
    "drawNumber" INTEGER NOT NULL,
    "prizeId" TEXT,
    "status" "WinnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "seed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestWinner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestEvent" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsCounter" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "chatTgId" BIGINT NOT NULL,
    "threadMessageId" INTEGER,
    "mode" "SmsMode" NOT NULL,
    "target" INTEGER NOT NULL,
    "everyN" INTEGER,
    "messagesSeen" INTEGER NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    "status" "SmsStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedByTgId" BIGINT NOT NULL,
    "announceEvery" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SmsCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsCounterParticipant" (
    "id" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "position" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsCounterParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramGift" (
    "id" TEXT NOT NULL,
    "telegramGiftId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GiftType" NOT NULL DEFAULT 'REGULAR',
    "imageUrl" TEXT,
    "stickerFileId" TEXT,
    "emoji" TEXT,
    "collection" TEXT,
    "rarity" TEXT,
    "starCost" INTEGER,
    "upgradeStarCost" INTEGER,
    "transferable" BOOLEAN NOT NULL DEFAULT false,
    "availability" "GiftAvailability" NOT NULL DEFAULT 'UNKNOWN',
    "totalCount" INTEGER,
    "remainingCount" INTEGER,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramGift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftDelivery" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "contestId" TEXT,
    "winnerId" TEXT,
    "prizeId" TEXT,
    "giftId" TEXT,
    "recipientTgId" BIGINT NOT NULL,
    "recipientName" TEXT,
    "method" "DeliveryMethod" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "note" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StarsTransaction" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "contestId" TEXT,
    "tgUserId" BIGINT NOT NULL,
    "username" TEXT,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BID',
    "status" "StarsTxStatus" NOT NULL DEFAULT 'PENDING',
    "telegramPaymentChargeId" TEXT,
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StarsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NFTAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "network" TEXT,
    "contractAddress" TEXT,
    "tokenId" TEXT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "externalUrl" TEXT,
    "status" "NftStatus" NOT NULL DEFAULT 'AVAILABLE',
    "transferRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NFTAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "botId" TEXT,
    "key" "TemplateKey" NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mediaId" TEXT,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumEmoji" (
    "id" TEXT NOT NULL,
    "customEmojiId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "fallback" TEXT NOT NULL DEFAULT '⭐',
    "previewUrl" TEXT,
    "stickerFileId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumEmoji_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaTelegramFile" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "MediaTelegramFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "AIJobStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "botId" TEXT,
    "botKey" TEXT NOT NULL,
    "updateId" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WhiteLabelPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceStars" INTEGER NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "graceDays" INTEGER NOT NULL DEFAULT 3,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhiteLabelPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSubscription" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "botId" TEXT,
    "planId" TEXT NOT NULL,
    "status" "BotSubStatus" NOT NULL DEFAULT 'PENDING',
    "priceStars" INTEGER NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionChargeId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notifiedExpiringAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "telegramPaymentChargeId" TEXT NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotUser" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "mode" "BroadcastMode" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "viaBotId" TEXT,
    "text" TEXT NOT NULL,
    "mediaId" TEXT,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "permissionLost" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "chatTgId" BIGINT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRole_userId_key" ON "AdminRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBot_telegramId_key" ON "TelegramBot"("telegramId");

-- CreateIndex
CREATE INDEX "TelegramBot_ownerId_idx" ON "TelegramBot"("ownerId");

-- CreateIndex
CREATE INDEX "TelegramChat_chatId_idx" ON "TelegramChat"("chatId");

-- CreateIndex
CREATE INDEX "TelegramChat_ownerId_idx" ON "TelegramChat"("ownerId");

-- CreateIndex
CREATE INDEX "TelegramChat_status_idx" ON "TelegramChat"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChat_botId_chatId_key" ON "TelegramChat"("botId", "chatId");

-- CreateIndex
CREATE INDEX "TelegramChannel_ownerId_idx" ON "TelegramChannel"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChannel_botId_chatId_key" ON "TelegramChannel"("botId", "chatId");

-- CreateIndex
CREATE INDEX "ChannelPost_channelId_discussionMessageId_idx" ON "ChannelPost"("channelId", "discussionMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPost_channelId_messageId_key" ON "ChannelPost"("channelId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBusinessConnection_connectionId_key" ON "TelegramBusinessConnection"("connectionId");

-- CreateIndex
CREATE INDEX "TelegramBusinessConnection_ownerId_idx" ON "TelegramBusinessConnection"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOwnedGift_connectionId_ownedGiftId_key" ON "BusinessOwnedGift"("connectionId", "ownedGiftId");

-- CreateIndex
CREATE INDEX "Contest_ownerId_status_idx" ON "Contest"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Contest_botId_status_idx" ON "Contest"("botId", "status");

-- CreateIndex
CREATE INDEX "Contest_targetChatTgId_status_idx" ON "Contest"("targetChatTgId", "status");

-- CreateIndex
CREATE INDEX "Contest_status_endsAt_idx" ON "Contest"("status", "endsAt");

-- CreateIndex
CREATE INDEX "ContestPrize_contestId_idx" ON "ContestPrize"("contestId");

-- CreateIndex
CREATE INDEX "ContestParticipant_contestId_score_idx" ON "ContestParticipant"("contestId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipant_contestId_tgUserId_key" ON "ContestParticipant"("contestId", "tgUserId");

-- CreateIndex
CREATE INDEX "ContestWinner_contestId_status_idx" ON "ContestWinner"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContestWinner_contestId_drawNumber_place_key" ON "ContestWinner"("contestId", "drawNumber", "place");

-- CreateIndex
CREATE INDEX "ContestEvent_contestId_createdAt_idx" ON "ContestEvent"("contestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsCounter_contestId_key" ON "SmsCounter"("contestId");

-- CreateIndex
CREATE INDEX "SmsCounter_chatTgId_status_idx" ON "SmsCounter"("chatTgId", "status");

-- CreateIndex
CREATE INDEX "SmsCounterParticipant_counterId_tgUserId_idx" ON "SmsCounterParticipant"("counterId", "tgUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsCounterParticipant_counterId_position_key" ON "SmsCounterParticipant"("counterId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGift_telegramGiftId_key" ON "TelegramGift"("telegramGiftId");

-- CreateIndex
CREATE INDEX "TelegramGift_type_availability_idx" ON "TelegramGift"("type", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "GiftDelivery_idempotencyKey_key" ON "GiftDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GiftDelivery_botId_status_idx" ON "GiftDelivery"("botId", "status");

-- CreateIndex
CREATE INDEX "GiftDelivery_contestId_idx" ON "GiftDelivery"("contestId");

-- CreateIndex
CREATE UNIQUE INDEX "StarsTransaction_telegramPaymentChargeId_key" ON "StarsTransaction"("telegramPaymentChargeId");

-- CreateIndex
CREATE INDEX "StarsTransaction_contestId_status_idx" ON "StarsTransaction"("contestId", "status");

-- CreateIndex
CREATE INDEX "NFTAsset_ownerId_idx" ON "NFTAsset"("ownerId");

-- CreateIndex
CREATE INDEX "MessageTemplate_ownerId_key_idx" ON "MessageTemplate"("ownerId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumEmoji_customEmojiId_key" ON "PremiumEmoji"("customEmojiId");

-- CreateIndex
CREATE INDEX "MediaFile_ownerId_idx" ON "MediaFile"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTelegramFile_mediaId_botId_key" ON "MediaTelegramFile"("mediaId", "botId");

-- CreateIndex
CREATE INDEX "AIJob_ownerId_createdAt_idx" ON "AIJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_botKey_updateId_key" ON "WebhookEvent"("botKey", "updateId");

-- CreateIndex
CREATE INDEX "ActivityLog_actorId_createdAt_idx" ON "ActivityLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_level_createdAt_idx" ON "ActivityLog"("level", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhiteLabelPlan_code_key" ON "WhiteLabelPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BotSubscription_botId_key" ON "BotSubscription"("botId");

-- CreateIndex
CREATE INDEX "BotSubscription_ownerId_idx" ON "BotSubscription"("ownerId");

-- CreateIndex
CREATE INDEX "BotSubscription_status_periodEnd_idx" ON "BotSubscription"("status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_telegramPaymentChargeId_key" ON "SubscriptionPayment"("telegramPaymentChargeId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_paidAt_idx" ON "SubscriptionPayment"("paidAt");

-- CreateIndex
CREATE INDEX "BotUser_botId_isBlocked_idx" ON "BotUser"("botId", "isBlocked");

-- CreateIndex
CREATE UNIQUE INDEX "BotUser_botId_tgUserId_key" ON "BotUser"("botId", "tgUserId");

-- CreateIndex
CREATE INDEX "Broadcast_status_idx" ON "Broadcast"("status");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_chatTgId_key" ON "BroadcastRecipient"("broadcastId", "chatTgId");

-- AddForeignKey
ALTER TABLE "AdminRole" ADD CONSTRAINT "AdminRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBot" ADD CONSTRAINT "TelegramBot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChat" ADD CONSTRAINT "TelegramChat_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChat" ADD CONSTRAINT "TelegramChat_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChannel" ADD CONSTRAINT "TelegramChannel_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChannel" ADD CONSTRAINT "TelegramChannel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChannel" ADD CONSTRAINT "TelegramChannel_discussionChatId_fkey" FOREIGN KEY ("discussionChatId") REFERENCES "TelegramChat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPost" ADD CONSTRAINT "ChannelPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TelegramChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBusinessConnection" ADD CONSTRAINT "TelegramBusinessConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBusinessConnection" ADD CONSTRAINT "TelegramBusinessConnection_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOwnedGift" ADD CONSTRAINT "BusinessOwnedGift_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "TelegramBusinessConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "TelegramChat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TelegramChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_postMediaId_fkey" FOREIGN KEY ("postMediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestPrize" ADD CONSTRAINT "ContestPrize_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestPrize" ADD CONSTRAINT "ContestPrize_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "TelegramGift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestPrize" ADD CONSTRAINT "ContestPrize_nftAssetId_fkey" FOREIGN KEY ("nftAssetId") REFERENCES "NFTAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestWinner" ADD CONSTRAINT "ContestWinner_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestWinner" ADD CONSTRAINT "ContestWinner_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ContestParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestWinner" ADD CONSTRAINT "ContestWinner_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "ContestPrize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestEvent" ADD CONSTRAINT "ContestEvent_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsCounter" ADD CONSTRAINT "SmsCounter_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsCounter" ADD CONSTRAINT "SmsCounter_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsCounterParticipant" ADD CONSTRAINT "SmsCounterParticipant_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "SmsCounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDelivery" ADD CONSTRAINT "GiftDelivery_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDelivery" ADD CONSTRAINT "GiftDelivery_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDelivery" ADD CONSTRAINT "GiftDelivery_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "ContestWinner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDelivery" ADD CONSTRAINT "GiftDelivery_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "ContestPrize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDelivery" ADD CONSTRAINT "GiftDelivery_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "TelegramGift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarsTransaction" ADD CONSTRAINT "StarsTransaction_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarsTransaction" ADD CONSTRAINT "StarsTransaction_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NFTAsset" ADD CONSTRAINT "NFTAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTelegramFile" ADD CONSTRAINT "MediaTelegramFile_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTelegramFile" ADD CONSTRAINT "MediaTelegramFile_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotSubscription" ADD CONSTRAINT "BotSubscription_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotSubscription" ADD CONSTRAINT "BotSubscription_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotSubscription" ADD CONSTRAINT "BotSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WhiteLabelPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BotSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotUser" ADD CONSTRAINT "BotUser_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

