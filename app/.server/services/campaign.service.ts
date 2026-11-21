import type { CampaignStatus } from "@prisma/client";
import prisma from "../../db.server";
import {
  canTransition,
  findOverlappingProducts,
  validateCampaignInput,
  type CampaignInput,
} from "../../lib/campaign-validation";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { planFor, type Plan } from "../../lib/plans";
import { getShopPlan } from "./billing.service";
import {
  findActiveTargets,
  findCampaign,
  insertCampaign,
  removeCampaign,
  replaceCampaign,
  setCampaignStatus,
  type CampaignDetail,
  type CampaignWriteData,
} from "../repositories/campaign.repository";
import { fetchProductsByIds } from "../shopify/products";
import type { AdminGraphqlClient } from "../shopify/graphql";
import { recordAudit } from "./audit.service";
import {
  FUNCTION_CONFIG_MAX_BYTES,
  serializeFunctionConfig,
} from "../../lib/discount-config";
import {
  removeCampaignDiscount,
  syncCampaignDiscount,
  type SyncOutcome,
} from "./discount-sync.service";
import { syncStorefrontConfig } from "./storefront-sync.service";

/** Authenticated tenant context every campaign operation runs under. */
export type TenantContext = {
  shopId: string;
  actorId: string | null;
  admin: AdminGraphqlClient;
  /** The shop's plan; looked up from Shopify when not given. */
  plan?: Plan;
};

/** A change the shop's plan doesn't allow; the message names the plan that does. */
export class PlanLimitError extends AppError {
  constructor(message: string) {
    super(message, 403, "PLAN_LIMIT");
  }
}

async function resolvePlan(ctx: TenantContext): Promise<Plan> {
  return ctx.plan ?? (await getShopPlan(ctx.shopId, ctx.admin)).plan;
}

function upgradeHint(check: (plan: Plan) => boolean, what: string) {
  const next = planFor(check);
  return next ? ` Upgrade to ${next.name} for ${what}.` : "";
}

function assertTierLimit(plan: Plan, count: number) {
  if (count <= plan.tiersPerCampaign) return;
  throw new ValidationError(
    {
      tiers: `Your ${plan.name} plan allows ${plan.tiersPerCampaign} tiers per campaign.${upgradeHint(
        (p) => p.tiersPerCampaign >= count,
        `up to ${planFor((p) => p.tiersPerCampaign >= count)?.tiersPerCampaign} tiers`,
      )}`,
    },
    "This campaign has more tiers than your plan allows.",
  );
}

/**
 * Plan limits on what's live: number of ACTIVE campaigns and distinct
 * products across them. Runs inside the activation transaction, after the
 * per-shop lock, so concurrent activations can't both slip under a limit.
 */
async function assertLiveLimits(
  tx: Parameters<typeof findActiveTargets>[0],
  shopId: string,
  campaignId: string,
  plan: Plan,
  productGids: string[],
  activating: boolean,
) {
  if (activating) {
    const active = await tx.campaign.count({ where: { shopId, status: "ACTIVE", id: { not: campaignId } } });
    if (active >= plan.activeCampaigns) {
      throw new PlanLimitError(
        `Your ${plan.name} plan allows ${plan.activeCampaigns} active ${plan.activeCampaigns === 1 ? "campaign" : "campaigns"}. Pause one first.${upgradeHint(
          (p) => p.activeCampaigns > active,
          "more active campaigns",
        )}`,
      );
    }
  }
  if (plan.liveProducts !== null) {
    const others = await tx.campaignProduct.findMany({
      where: { shopId, campaign: { status: "ACTIVE", id: { not: campaignId } } },
      distinct: ["productGid"],
      select: { productGid: true },
    });
    const total = new Set([...others.map((o) => o.productGid), ...productGids]).size;
    if (total > plan.liveProducts) {
      throw new PlanLimitError(
        `Your ${plan.name} plan allows discounts on ${plan.liveProducts} products; this would make ${total} live.${upgradeHint(
          (p) => p.liveProducts === null || p.liveProducts >= total,
          "more products",
        )}`,
      );
    }
  }
}

/**
 * Confirms every selected product (and variant) exists in the shop via the
 * Admin API and returns a display snapshot taken from Shopify, not from the
 * client payload.
 */
async function resolveTargets(
  admin: AdminGraphqlClient,
  input: CampaignInput,
): Promise<CampaignWriteData["products"]> {
  const resolved = await fetchProductsByIds(
    admin,
    input.products.map((p) => p.productGid),
  );
  const fieldErrors: Record<string, string> = {};
  const products: CampaignWriteData["products"] = [];

  input.products.forEach((selection, i) => {
    const product = resolved.get(selection.productGid);
    if (!product) {
      fieldErrors[`products.${i}`] =
        "This product no longer exists in your store";
      return;
    }
    const variantsById = new Map(
      product.variants.map((v) => [v.variantGid, v]),
    );
    const variants = [];
    for (const variantGid of selection.variantGids) {
      const variant = variantsById.get(variantGid);
      if (!variant) {
        fieldErrors[`products.${i}`] =
          `A selected variant of "${product.title}" no longer exists`;
        return;
      }
      variants.push(variant);
    }
    // Selecting every variant is equivalent to targeting the whole product,
    // which also keeps future variants eligible.
    const allSelected =
      variants.length > 0 && variants.length === product.variants.length;
    products.push({
      productGid: product.productGid,
      title: product.title,
      handle: product.handle,
      imageUrl: product.imageUrl,
      variants: allSelected ? [] : variants,
    });
  });

  if (Object.keys(fieldErrors).length) throw new ValidationError(fieldErrors);
  return products;
}

function toWriteData(
  input: CampaignInput,
  products: CampaignWriteData["products"],
): CampaignWriteData {
  return {
    name: input.name,
    discountType: input.discountType,
    discountLabel: input.discountLabel ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    products,
    tiers: input.tiers.map((t) => ({
      minQuantity: t.minQuantity,
      value: Number(t.value).toFixed(2),
      label: t.label ?? null,
    })),
  };
}

function parseOrThrow(raw: unknown): CampaignInput {
  const result = validateCampaignInput(raw);
  if (!result.success) throw new ValidationError(result.fieldErrors);
  return result.data;
}

/**
 * Rejects activation when another ACTIVE campaign already discounts one of
 * the same products/variants. Overlap policy: see
 * docs/DISCOUNT_FUNCTION_DESIGN.md#overlapping-campaigns.
 */
async function assertNoActiveOverlap(
  tx: Parameters<typeof findActiveTargets>[0],
  shopId: string,
  campaignId: string,
  products: { productGid: string; variantGids: string[] }[],
) {
  // Serialise activations per shop so two concurrent requests can't both
  // pass the overlap check. The lock is released when the transaction ends.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shopId}))`;
  const others = await findActiveTargets(tx, shopId, campaignId);
  for (const other of others) {
    const overlapping = findOverlappingProducts(
      products,
      other.products.map((p) => ({
        productGid: p.productGid,
        variantGids: p.variants.map((v) => v.variantGid),
      })),
    );
    if (overlapping.length) {
      const titles = other.products
        .filter((p) => overlapping.includes(p.productGid))
        .map((p) => p.title);
      throw new ConflictError(
        `"${other.name}" is already active for ${titles.join(", ")}. Pause it or remove those products first.`,
      );
    }
  }
}

function targetsOf(campaign: CampaignDetail) {
  return campaign.products.map((p) => ({
    productGid: p.productGid,
    variantGids: p.variants.map((v) => v.variantGid),
  }));
}

/**
 * Shopify doesn't pass metafield values over 10,000 bytes to Functions, so a
 * campaign whose configuration is too large could never apply at checkout.
 */
function assertConfigFits(
  discountType: CampaignDetail["discountType"],
  products: { productGid: string; variantGids: string[] }[],
  tiers: { minQuantity: number; value: string }[],
) {
  const { bytes } = serializeFunctionConfig({ discountType, message: "", products, tiers });
  if (bytes > FUNCTION_CONFIG_MAX_BYTES) {
    throw new ValidationError(
      { products: "Too many products or variants for one campaign. Target whole products instead of individual variants, or split it into several campaigns." },
      "This campaign is too large to apply at checkout.",
    );
  }
}

export type ChangeSyncResult = {
  discount: SyncOutcome | null;
  storefront: SyncOutcome | null;
};

/**
 * Reconciles Shopify after a committed change: the campaign's automatic
 * discount, and the storefront widget data when an ACTIVE campaign is
 * involved before or after the change.
 */
async function syncAfterChange(
  ctx: TenantContext,
  campaignId: string,
  statusBefore: CampaignStatus,
  statusAfter: CampaignStatus,
  hadDiscount: boolean,
): Promise<ChangeSyncResult> {
  const needsDiscountSync =
    hadDiscount || statusAfter === "ACTIVE" || statusAfter === "PAUSED";
  const discount = needsDiscountSync
    ? await syncCampaignDiscount(ctx.admin, ctx.shopId, campaignId)
    : null;
  const storefront =
    statusBefore === "ACTIVE" || statusAfter === "ACTIVE"
      ? await syncStorefrontConfig(ctx.admin, ctx.shopId)
      : null;
  return { discount, storefront };
}

export async function getCampaign(shopId: string, id: string) {
  const campaign = await findCampaign(shopId, id);
  if (!campaign) throw new NotFoundError("Campaign");
  return campaign;
}

/** Creates a campaign in DRAFT. Drafts are never applied at checkout. */
export async function createDraftCampaign(ctx: TenantContext, raw: unknown) {
  const input = parseOrThrow(raw);
  assertTierLimit(await resolvePlan(ctx), input.tiers.length);
  const products = await resolveTargets(ctx.admin, input);
  return prisma.$transaction(async (tx) => {
    const campaign = await insertCampaign(
      tx,
      ctx.shopId,
      toWriteData(input, products),
    );
    await recordAudit(
      {
        shopId: ctx.shopId,
        actorId: ctx.actorId,
        action: "campaign.created",
        entityType: "Campaign",
        entityId: campaign.id,
        metadata: { name: campaign.name },
      },
      tx,
    );
    return campaign;
  });
}

export async function updateCampaign(
  ctx: TenantContext,
  id: string,
  raw: unknown,
) {
  const existing = await getCampaign(ctx.shopId, id);
  if (existing.status === "ARCHIVED") {
    throw new ConflictError("Restore this campaign before editing it.");
  }
  const input = parseOrThrow(raw);
  const plan = await resolvePlan(ctx);
  assertTierLimit(plan, input.tiers.length);
  const products = await resolveTargets(ctx.admin, input);
  const writeData = toWriteData(input, products);
  if (existing.status === "ACTIVE" || existing.status === "PAUSED") {
    assertConfigFits(
      writeData.discountType,
      writeData.products.map((p) => ({
        productGid: p.productGid,
        variantGids: p.variants.map((v) => v.variantGid),
      })),
      writeData.tiers,
    );
  }

  const campaign = await prisma.$transaction(async (tx) => {
    if (existing.status === "ACTIVE") {
      await assertNoActiveOverlap(
        tx,
        ctx.shopId,
        id,
        products.map((p) => ({
          productGid: p.productGid,
          variantGids: p.variants.map((v) => v.variantGid),
        })),
      );
      await assertLiveLimits(tx, ctx.shopId, id, plan, products.map((p) => p.productGid), false);
    }
    const campaign = await replaceCampaign(tx, ctx.shopId, id, writeData);
    await recordAudit(
      {
        shopId: ctx.shopId,
        actorId: ctx.actorId,
        action: "campaign.updated",
        entityType: "Campaign",
        entityId: id,
        metadata: { name: campaign.name },
      },
      tx,
    );
    return campaign;
  });

  const sync = await syncAfterChange(
    ctx,
    id,
    existing.status,
    campaign.status,
    Boolean(existing.shopifyDiscountId),
  );
  return { ...campaign, sync };
}

export async function changeCampaignStatus(
  ctx: TenantContext,
  id: string,
  to: CampaignStatus,
) {
  const existing = await getCampaign(ctx.shopId, id);
  if (existing.status === to) {
    return { ...existing, sync: { discount: null, storefront: null } as ChangeSyncResult };
  }
  if (!canTransition(existing.status, to)) {
    throw new ConflictError(
      `A ${existing.status.toLowerCase()} campaign can't be moved to ${to.toLowerCase()}.`,
    );
  }

  const plan = to === "ACTIVE" ? await resolvePlan(ctx) : null;
  if (to === "ACTIVE") {
    assertTierLimit(plan!, existing.tiers.length);
    if (!existing.products.length || !existing.tiers.length) {
      throw new ConflictError(
        "Add at least one product and one quantity tier before activating.",
      );
    }
    assertConfigFits(
      existing.discountType,
      targetsOf(existing),
      existing.tiers.map((t) => ({ minQuantity: t.minQuantity, value: t.value.toString() })),
    );
  }

  await prisma.$transaction(async (tx) => {
    if (to === "ACTIVE") {
      await assertNoActiveOverlap(tx, ctx.shopId, id, targetsOf(existing));
      await assertLiveLimits(tx, ctx.shopId, id, plan!, existing.products.map((p) => p.productGid), true);
    }
    await setCampaignStatus(tx, ctx.shopId, id, to);
    await recordAudit(
      {
        shopId: ctx.shopId,
        actorId: ctx.actorId,
        action: "campaign.status_changed",
        entityType: "Campaign",
        entityId: id,
        metadata: { from: existing.status, to },
      },
      tx,
    );
  });

  const sync = await syncAfterChange(
    ctx,
    id,
    existing.status,
    to,
    Boolean(existing.shopifyDiscountId),
  );
  return { ...existing, status: to, sync };
}

/** Only drafts and archived campaigns can be permanently deleted. */
export async function deleteCampaign(ctx: TenantContext, id: string) {
  const existing = await getCampaign(ctx.shopId, id);
  if (existing.status !== "DRAFT" && existing.status !== "ARCHIVED") {
    throw new ConflictError("Archive this campaign before deleting it.");
  }
  // Normally already removed when the campaign left ACTIVE/PAUSED; this
  // covers a previous sync failure so no orphaned discount is left behind.
  if (existing.shopifyDiscountId) {
    await removeCampaignDiscount(ctx.admin, existing.shopifyDiscountId);
  }
  await prisma.$transaction(async (tx) => {
    await removeCampaign(tx, ctx.shopId, id);
    await recordAudit(
      {
        shopId: ctx.shopId,
        actorId: ctx.actorId,
        action: "campaign.deleted",
        entityType: "Campaign",
        entityId: id,
        metadata: { name: existing.name },
      },
      tx,
    );
  });
}
