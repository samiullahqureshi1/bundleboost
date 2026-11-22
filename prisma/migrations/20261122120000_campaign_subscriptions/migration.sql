-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('ONE_TIME', 'SUBSCRIPTION', 'BOTH');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "purchaseType" "PurchaseType" NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "recurringCycleLimit" INTEGER NOT NULL DEFAULT 1;
