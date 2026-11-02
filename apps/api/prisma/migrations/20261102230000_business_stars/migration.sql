-- AlterEnum
ALTER TYPE "DeliveryMethod" ADD VALUE 'BUSINESS_STARS';

-- AlterTable
ALTER TABLE "GiftDelivery" ADD COLUMN "businessConnectionId" TEXT;
