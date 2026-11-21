-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('NOT_SYNCED', 'SYNCED', 'ERROR');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncStatus" "SyncStatus" NOT NULL DEFAULT 'NOT_SYNCED';

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "storefrontSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Campaign_shopId_syncStatus_idx" ON "Campaign"("shopId", "syncStatus");
