import prisma from "../../db.server";
import { themeEditorUrl } from "../theme";

/**
 * Everything the home page needs, in one round of parallel queries. Counts
 * come from BundleBoost's own records; nothing is estimated.
 */
export async function getHomeData(shop: { id: string; domain: string; name: string | null }) {
  const [statusCounts, live, syncErrors, firstDraft, products, settings, widgetEdits, recent, activity] =
    await Promise.all([
      prisma.campaign.groupBy({
        by: ["status"],
        where: { shopId: shop.id },
        _count: { _all: true },
      }),
      prisma.campaign.count({
        where: { shopId: shop.id, status: "ACTIVE", syncStatus: "SYNCED" },
      }),
      prisma.campaign.count({ where: { shopId: shop.id, syncStatus: "ERROR" } }),
      prisma.campaign.findFirst({
        where: { shopId: shop.id, status: "DRAFT" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
      prisma.campaignProduct.findMany({
        where: { shopId: shop.id, campaign: { status: "ACTIVE", syncStatus: "SYNCED" } },
        distinct: ["productGid"],
        select: { productGid: true },
      }),
      prisma.shopSettings.upsert({
        where: { shopId: shop.id },
        create: { shopId: shop.id },
        update: {},
      }),
      prisma.auditLog.count({
        where: { shopId: shop.id, action: "widget_settings.updated" },
      }),
      prisma.campaign.findMany({
        where: { shopId: shop.id, status: { not: "ARCHIVED" } },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: {
          tiers: { orderBy: { position: "asc" }, select: { minQuantity: true, value: true, label: true } },
          products: { orderBy: { createdAt: "asc" }, take: 1, select: { title: true } },
          _count: { select: { products: true } },
        },
      }),
      prisma.auditLog.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, action: true, createdAt: true },
      }),
    ]);

  const counts = { DRAFT: 0, ACTIVE: 0, PAUSED: 0, ARCHIVED: 0 };
  for (const row of statusCounts) counts[row.status] = row._count._all;

  return {
    shopName: shop.name,
    counts,
    totalCampaigns: Object.values(counts).reduce((a, b) => a + b, 0),
    liveCampaigns: live,
    liveProducts: products.length,
    syncErrors,
    firstDraftId: firstDraft?.id ?? null,
    widgetCustomized: widgetEdits > 0,
    themeBlockConfirmed: Boolean(settings.themeBlockConfirmedAt),
    setupGuideDismissed: Boolean(settings.setupGuideDismissedAt),
    // Opens the theme editor on a product template with the block added.
    themeEditorUrl: themeEditorUrl(shop.domain),
    recentCampaigns: recent.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      syncStatus: c.syncStatus,
      discountType: c.discountType,
      productCount: c._count.products,
      firstProductTitle: c.products[0]?.title ?? null,
      tiers: c.tiers.map((t) => ({
        minQuantity: t.minQuantity,
        value: t.value.toString(),
        label: t.label,
      })),
    })),
    recentActivity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export type HomeData = Awaited<ReturnType<typeof getHomeData>>;

/** Persists the merchant's setup-guide choices for this shop. */
export async function updateSetupGuide(
  shopId: string,
  change: "dismiss" | "restore" | "confirmTheme" | "unconfirmTheme",
) {
  const data =
    change === "dismiss"
      ? { setupGuideDismissedAt: new Date() }
      : change === "restore"
        ? { setupGuideDismissedAt: null }
        : change === "confirmTheme"
          ? { themeBlockConfirmedAt: new Date() }
          : { themeBlockConfirmedAt: null };
  await prisma.shopSettings.upsert({
    where: { shopId },
    create: { shopId, ...data },
    update: data,
  });
}
