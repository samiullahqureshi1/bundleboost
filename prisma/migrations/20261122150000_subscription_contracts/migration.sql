-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingAttemptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'ACTION_REQUIRED');

-- CreateTable
CREATE TABLE "SubscriptionContract" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyContractId" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL,
    "customerGid" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "originOrderName" TEXT,
    "interval" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "nextBillingDate" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastBilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionBillingAttempt" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "shopifyAttemptId" TEXT,
    "cycleIndex" INTEGER NOT NULL,
    "status" "BillingAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "orderGid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionBillingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionContract_shopifyContractId_key" ON "SubscriptionContract"("shopifyContractId");

-- CreateIndex
CREATE INDEX "SubscriptionContract_shopId_status_nextBillingDate_idx" ON "SubscriptionContract"("shopId", "status", "nextBillingDate");

-- CreateIndex
CREATE INDEX "SubscriptionContract_shopId_customerGid_idx" ON "SubscriptionContract"("shopId", "customerGid");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionBillingAttempt_shopifyAttemptId_key" ON "SubscriptionBillingAttempt"("shopifyAttemptId");

-- CreateIndex
CREATE INDEX "SubscriptionBillingAttempt_contractId_cycleIndex_idx" ON "SubscriptionBillingAttempt"("contractId", "cycleIndex");

-- AddForeignKey
ALTER TABLE "SubscriptionContract" ADD CONSTRAINT "SubscriptionContract_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionBillingAttempt" ADD CONSTRAINT "SubscriptionBillingAttempt_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SubscriptionContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

