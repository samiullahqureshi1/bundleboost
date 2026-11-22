-- CreateEnum
CREATE TYPE "FrequencyInterval" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "optionName" TEXT NOT NULL DEFAULT 'Delivery every',
    "shopifyGroupId" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'NOT_SYNCED',
    "syncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionFrequency" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "interval" "FrequencyInterval" NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "label" TEXT,
    "position" INTEGER NOT NULL,
    "shopifySellingPlanId" TEXT,

    CONSTRAINT "SubscriptionFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlanProduct" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "SubscriptionPlanProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionPlan_shopId_updatedAt_idx" ON "SubscriptionPlan"("shopId", "updatedAt");

-- CreateIndex
CREATE INDEX "SubscriptionFrequency_planId_position_idx" ON "SubscriptionFrequency"("planId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionFrequency_planId_interval_intervalCount_key" ON "SubscriptionFrequency"("planId", "interval", "intervalCount");

-- CreateIndex
CREATE INDEX "SubscriptionPlanProduct_shopId_productGid_idx" ON "SubscriptionPlanProduct"("shopId", "productGid");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlanProduct_planId_productGid_key" ON "SubscriptionPlanProduct"("planId", "productGid");

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionFrequency" ADD CONSTRAINT "SubscriptionFrequency_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanProduct" ADD CONSTRAINT "SubscriptionPlanProduct_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

