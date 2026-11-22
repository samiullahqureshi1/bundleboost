-- AlterTable
ALTER TABLE "WidgetSettings" ADD COLUMN     "frequencyLabel" TEXT NOT NULL DEFAULT 'Delivery frequency',
ADD COLUMN     "oneTimeLabel" TEXT NOT NULL DEFAULT 'One-time purchase',
ADD COLUMN     "showPurchaseOptions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "subscribeLabel" TEXT NOT NULL DEFAULT 'Subscribe & save {discount}';
