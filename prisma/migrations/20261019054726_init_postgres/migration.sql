-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "WidgetLayout" AS ENUM ('STACKED', 'GRID');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "currencyCode" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "defaultDiscountLabel" TEXT NOT NULL DEFAULT 'Volume discount',
    "combineWithProductDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "combineWithOrderDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "combineWithShippingDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "discountType" "DiscountType" NOT NULL,
    "discountLabel" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "shopifyDiscountId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignProduct" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVariant" (
    "id" TEXT NOT NULL,
    "campaignProductId" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "CampaignVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuantityTier" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "label" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QuantityTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "heading" TEXT NOT NULL DEFAULT 'Buy more, save more',
    "layout" "WidgetLayout" NOT NULL DEFAULT 'STACKED',
    "accentColor" TEXT NOT NULL DEFAULT '#008060',
    "textColor" TEXT NOT NULL DEFAULT '#202223',
    "backgroundColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "borderRadius" INTEGER NOT NULL DEFAULT 8,
    "showSavings" BOOLEAN NOT NULL DEFAULT true,
    "highlightBestDeal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifySubscriptionId" TEXT,
    "planName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "test" BOOLEAN NOT NULL DEFAULT false,
    "trialDays" INTEGER,
    "currentPeriodEnd" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shopId_key" ON "ShopSettings"("shopId");

-- CreateIndex
CREATE INDEX "Campaign_shopId_status_idx" ON "Campaign"("shopId", "status");

-- CreateIndex
CREATE INDEX "Campaign_shopId_updatedAt_idx" ON "Campaign"("shopId", "updatedAt");

-- CreateIndex
CREATE INDEX "CampaignProduct_shopId_productGid_idx" ON "CampaignProduct"("shopId", "productGid");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignProduct_campaignId_productGid_key" ON "CampaignProduct"("campaignId", "productGid");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVariant_campaignProductId_variantGid_key" ON "CampaignVariant"("campaignProductId", "variantGid");

-- CreateIndex
CREATE INDEX "QuantityTier_campaignId_position_idx" ON "QuantityTier"("campaignId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuantityTier_campaignId_minQuantity_key" ON "QuantityTier"("campaignId", "minQuantity");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetSettings_shopId_key" ON "WidgetSettings"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_shopId_key" ON "BillingSubscription"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_webhookId_key" ON "WebhookEvent"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopDomain_topic_idx" ON "WebhookEvent"("shopDomain", "topic");

-- CreateIndex
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProduct" ADD CONSTRAINT "CampaignProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVariant" ADD CONSTRAINT "CampaignVariant_campaignProductId_fkey" FOREIGN KEY ("campaignProductId") REFERENCES "CampaignProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityTier" ADD CONSTRAINT "QuantityTier_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetSettings" ADD CONSTRAINT "WidgetSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
