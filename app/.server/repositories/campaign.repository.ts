import type { CampaignStatus, DiscountType, Prisma, PurchaseType } from "@prisma/client";
import prisma from "../../db.server";

/**
 * Data access for campaigns. Every function takes `shopId` and includes it in
 * the WHERE clause so a caller can never read or mutate another tenant's rows,
 * even with a guessed campaign id.
 */

export const campaignDetailInclude = {
  products: {
    orderBy: { createdAt: "asc" },
    include: { variants: { orderBy: { title: "asc" } } },
  },
  tiers: { orderBy: { position: "asc" } },
} satisfies Prisma.CampaignInclude;

export type CampaignDetail = Prisma.CampaignGetPayload<{
  include: typeof campaignDetailInclude;
}>;

export type CampaignWriteData = {
  name: string;
  discountType: DiscountType;
  discountLabel: string | null;
  purchaseType: PurchaseType;
  recurringCycleLimit: number;
  startsAt: Date | null;
  endsAt: Date | null;
  products: {
    productGid: string;
    title: string;
    handle: string | null;
    imageUrl: string | null;
    variants: { variantGid: string; title: string }[];
  }[];
  tiers: { minQuantity: number; value: string; label: string | null }[];
};

/**
 * Inserts a campaign's products, variants and tiers with batch statements —
 * a constant number of round trips however many variants are targeted
 * (nested creates issue one INSERT per row, which is slow against a remote
 * database such as Neon).
 */
async function insertChildren(
  tx: Prisma.TransactionClient,
  shopId: string,
  campaignId: string,
  data: CampaignWriteData,
) {
  if (data.tiers.length) {
    await tx.quantityTier.createMany({
      data: data.tiers.map((t, position) => ({
        campaignId,
        minQuantity: t.minQuantity,
        value: t.value,
        label: t.label,
        position,
      })),
    });
  }
  if (!data.products.length) return;
  const products = await tx.campaignProduct.createManyAndReturn({
    data: data.products.map((p) => ({
      campaignId,
      shopId,
      productGid: p.productGid,
      title: p.title,
      handle: p.handle,
      imageUrl: p.imageUrl,
    })),
    select: { id: true, productGid: true },
  });
  const idByGid = new Map(products.map((p) => [p.productGid, p.id]));
  const variants = data.products.flatMap((p) =>
    p.variants.map((v) => ({
      campaignProductId: idByGid.get(p.productGid)!,
      variantGid: v.variantGid,
      title: v.title,
    })),
  );
  if (variants.length) await tx.campaignVariant.createMany({ data: variants });
}

async function loadDetail(tx: Prisma.TransactionClient, shopId: string, id: string) {
  return tx.campaign.findFirstOrThrow({
    where: { id, shopId },
    include: campaignDetailInclude,
  });
}

export async function listCampaigns(
  shopId: string,
  options: { status?: CampaignStatus; includeArchived?: boolean } = {},
) {
  return prisma.campaign.findMany({
    where: {
      shopId,
      ...(options.status
        ? { status: options.status }
        : options.includeArchived
          ? {}
          : { status: { not: "ARCHIVED" } }),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      tiers: { orderBy: { position: "asc" } },
      // A few titles for the list's subtitle and search.
      products: { orderBy: { createdAt: "asc" }, take: 3, select: { title: true } },
      _count: { select: { products: true } },
    },
  });
}

export async function findCampaign(shopId: string, id: string) {
  return prisma.campaign.findFirst({
    where: { id, shopId },
    include: campaignDetailInclude,
  });
}

export async function insertCampaign(
  tx: Prisma.TransactionClient,
  shopId: string,
  data: CampaignWriteData,
) {
  const campaign = await tx.campaign.create({
    data: {
      shopId,
      name: data.name,
      discountType: data.discountType,
      discountLabel: data.discountLabel,
      purchaseType: data.purchaseType,
      recurringCycleLimit: data.recurringCycleLimit,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      status: "DRAFT",
    },
    select: { id: true },
  });
  await insertChildren(tx, shopId, campaign.id, data);
  return loadDetail(tx, shopId, campaign.id);
}

/** Replaces the campaign's fields, targets and tiers in one transaction. */
export async function replaceCampaign(
  tx: Prisma.TransactionClient,
  shopId: string,
  id: string,
  data: CampaignWriteData,
) {
  // Update first: throws (P2025) if the campaign isn't in this shop, before
  // any child rows are touched.
  await tx.campaign.update({
    where: { id, shopId },
    data: {
      name: data.name,
      discountType: data.discountType,
      discountLabel: data.discountLabel,
      purchaseType: data.purchaseType,
      recurringCycleLimit: data.recurringCycleLimit,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
    },
    select: { id: true },
  });
  await tx.campaignProduct.deleteMany({ where: { campaignId: id, shopId } });
  await tx.quantityTier.deleteMany({ where: { campaignId: id } });
  await insertChildren(tx, shopId, id, data);
  return loadDetail(tx, shopId, id);
}

export async function setCampaignStatus(
  tx: Prisma.TransactionClient,
  shopId: string,
  id: string,
  status: CampaignStatus,
) {
  return tx.campaign.update({
    where: { id, shopId },
    data: {
      status,
      archivedAt: status === "ARCHIVED" ? new Date() : null,
    },
  });
}

export async function removeCampaign(
  tx: Prisma.TransactionClient,
  shopId: string,
  id: string,
) {
  return tx.campaign.delete({ where: { id, shopId } });
}

/** Targets of every ACTIVE campaign in the shop, optionally excluding one. */
export async function findActiveTargets(
  tx: Prisma.TransactionClient,
  shopId: string,
  excludeCampaignId?: string,
) {
  return tx.campaign.findMany({
    where: {
      shopId,
      status: "ACTIVE",
      ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {}),
    },
    select: {
      id: true,
      name: true,
      products: {
        select: {
          productGid: true,
          title: true,
          variants: { select: { variantGid: true } },
        },
      },
    },
  });
}

export async function countCampaignsByStatus(shopId: string) {
  const rows = await prisma.campaign.groupBy({
    by: ["status"],
    where: { shopId },
    _count: { _all: true },
  });
  const counts: Record<CampaignStatus, number> = {
    DRAFT: 0,
    ACTIVE: 0,
    PAUSED: 0,
    ARCHIVED: 0,
  };
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

export async function countTargetedProducts(shopId: string) {
  const rows = await prisma.campaignProduct.findMany({
    where: { shopId, campaign: { status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } } },
    distinct: ["productGid"],
    select: { productGid: true },
  });
  return rows.length;
}
