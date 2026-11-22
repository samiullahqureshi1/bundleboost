import type { CampaignDetail } from "./repositories/campaign.repository";

/** Serialisable campaign shape for loaders (Prisma Decimal → string). */
export function toCampaignDto(campaign: CampaignDetail) {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    discountType: campaign.discountType,
    discountLabel: campaign.discountLabel,
    purchaseType: campaign.purchaseType,
    recurringCycleLimit: campaign.recurringCycleLimit,
    shopifyDiscountId: campaign.shopifyDiscountId,
    syncStatus: campaign.syncStatus,
    syncError: campaign.syncError,
    lastSyncedAt: campaign.lastSyncedAt?.toISOString() ?? null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    products: campaign.products.map((p) => ({
      productGid: p.productGid,
      title: p.title,
      imageUrl: p.imageUrl,
      variantGids: p.variants.map((v) => v.variantGid),
      variantTitles: p.variants.map((v) => v.title),
      totalVariants: null,
    })),
    tiers: campaign.tiers.map((t) => ({
      minQuantity: t.minQuantity,
      value: t.value.toString(),
      label: t.label,
    })),
  };
}

export type CampaignDto = ReturnType<typeof toCampaignDto>;
