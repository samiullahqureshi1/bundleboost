import prisma from "../../db.server";
import { logger } from "../logger";
import { adminQuery, type AdminGraphqlClient } from "../shopify/graphql";

/**
 * Configuration-level analytics derived from BundleBoost's own data plus the
 * store's product count. Sales metrics (discounted orders, revenue) need order
 * data and are intentionally absent until a later phase — nothing here is
 * estimated or made up.
 */

const PRODUCTS_COUNT = `#graphql
  query BundleBoostProductsCount {
    productsCount(limit: null) {
      count
      precision
    }
  }`;

async function storeProductCount(admin: AdminGraphqlClient): Promise<number | null> {
  try {
    const data = await adminQuery<{ productsCount: { count: number } }>(admin, PRODUCTS_COUNT);
    return data.productsCount.count;
  } catch (error) {
    if (error instanceof Response) throw error;
    // The page works without it; coverage just shows "unknown".
    logger.warn("Could not read product count", { error });
    return null;
  }
}

export async function getAnalytics(shopId: string, admin: AdminGraphqlClient) {
  const [statusRows, syncErrors, live, liveProducts, targetedProducts, activity, storeProducts] =
    await Promise.all([
      prisma.campaign.groupBy({ by: ["status"], where: { shopId }, _count: { _all: true } }),
      prisma.campaign.count({ where: { shopId, syncStatus: "ERROR" } }),
      prisma.campaign.findMany({
        where: { shopId, status: "ACTIVE", syncStatus: "SYNCED" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          discountType: true,
          tiers: { orderBy: { position: "asc" }, select: { minQuantity: true, value: true } },
          _count: { select: { products: true } },
        },
      }),
      prisma.campaignProduct.findMany({
        where: { shopId, campaign: { status: "ACTIVE", syncStatus: "SYNCED" } },
        distinct: ["productGid"],
        select: { productGid: true },
      }),
      prisma.campaignProduct.findMany({
        where: { shopId, campaign: { status: { not: "ARCHIVED" } } },
        distinct: ["productGid"],
        select: { productGid: true },
      }),
      prisma.auditLog.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, action: true, createdAt: true, metadata: true },
      }),
      storeProductCount(admin),
    ]);

  const counts = { DRAFT: 0, ACTIVE: 0, PAUSED: 0, ARCHIVED: 0 };
  for (const row of statusRows) counts[row.status] = row._count._all;

  const liveCampaigns = live.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.discountType === "PERCENTAGE" ? ("percentage" as const) : ("fixed" as const),
    productCount: c._count.products,
    tiers: c.tiers.map((t) => ({ qty: t.minQuantity, value: Number(t.value) })),
  }));
  const percentTiers = liveCampaigns.filter((c) => c.type === "percentage").flatMap((c) => c.tiers);

  return {
    counts,
    totalCampaigns: Object.values(counts).reduce((a, b) => a + b, 0),
    syncErrors,
    liveCampaigns,
    liveProducts: liveProducts.length,
    targetedProducts: targetedProducts.length,
    storeProducts,
    deepestPercent: percentTiers.length ? Math.max(...percentTiers.map((t) => t.value)) : null,
    lowestThreshold: liveCampaigns.length
      ? Math.min(...liveCampaigns.flatMap((c) => c.tiers.map((t) => t.qty)))
      : null,
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
      name:
        a.metadata && typeof a.metadata === "object" && "name" in a.metadata ? String(a.metadata.name) : null,
    })),
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;
