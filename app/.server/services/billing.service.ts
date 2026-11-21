import prisma from "../../db.server";
import { planFromHandle, PLAN_ORDER, type Plan, type PlanHandle } from "../../lib/plans";
import { env } from "../env";
import { logger } from "../logger";
import type { AdminGraphqlClient } from "../shopify/graphql";
import { fetchActiveSubscription, partnerApiConfigured } from "../shopify/partner";

/**
 * Billing runs on Shopify App Pricing: plans live in the Partner Dashboard,
 * merchants choose on Shopify's hosted plan page, and Shopify creates the
 * charge. BundleBoost never creates charges or sees payment details.
 *
 * The merchant's plan is read from the Partner API and cached on
 * BillingSubscription for a few minutes (Shopify's guidance, given the
 * Partner API's 4 requests/second limit). No subscription means Free.
 */

const CACHE_MS = 5 * 60 * 1000;

export type ShopPlan = {
  plan: Plan;
  /** false when the plan couldn't be confirmed with Shopify (then it's the last known plan, or Free). */
  verified: boolean;
  configured: boolean;
  renewsAt: string | null;
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
  pendingPlan: Plan | null;
  checkedAt: string | null;
};

const handleOf = (items: { handle: string | null }[] | undefined): PlanHandle | null => {
  const handles = (items ?? []).map((i) => i.handle).filter(Boolean) as string[];
  // Highest matching plan wins if more than one item is present.
  return [...PLAN_ORDER].reverse().find((h) => handles.includes(h)) ?? null;
};

/** The last known plan, without calling Shopify (for background work). */
export async function cachedPlan(shopId: string): Promise<Plan> {
  const row = await prisma.billingSubscription.findUnique({ where: { shopId } });
  return planFromHandle(row?.status === "ACTIVE" ? row.planName : "free");
}

export async function getShopPlan(
  shopId: string,
  admin: AdminGraphqlClient,
  options: { fresh?: boolean } = {},
): Promise<ShopPlan> {
  const configured = partnerApiConfigured();
  const row = await prisma.billingSubscription.findUnique({ where: { shopId } });
  const cached = (): ShopPlan => ({
    plan: planFromHandle(row?.status === "ACTIVE" ? row.planName : "free"),
    verified: false,
    configured,
    renewsAt: row?.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    pendingPlan: null,
    checkedAt: row?.lastCheckedAt?.toISOString() ?? null,
  });

  if (!configured) return cached();
  const fresh = row?.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < CACHE_MS;
  if (fresh && !options.fresh) return { ...cached(), verified: true };

  try {
    const subscription = await fetchActiveSubscription(admin);
    const handle = handleOf(subscription?.items) ?? "free";
    const renewsAt = subscription?.currentBillingCycle?.endTime ?? null;
    const data = {
      planName: handle,
      status: subscription ? "ACTIVE" : "NONE",
      currentPeriodEnd: renewsAt ? new Date(renewsAt) : null,
      lastCheckedAt: new Date(),
    };
    await prisma.billingSubscription.upsert({
      where: { shopId },
      create: { shopId, ...data },
      update: data,
    });
    const pending = handleOf(subscription?.pendingUpdate?.items);
    return {
      plan: planFromHandle(handle),
      verified: true,
      configured,
      renewsAt,
      trialEndsAt: subscription?.trialEndsAt ?? null,
      cancelAtEndOfCycle: subscription?.cancelAtEndOfCycle ?? false,
      pendingPlan: pending ? planFromHandle(pending) : null,
      checkedAt: data.lastCheckedAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.warn("Plan check failed; using last known plan", { shopId, error });
    return cached();
  }
}

/** What the shop uses today, compared with plan limits on the billing page. */
export async function getUsage(shopId: string) {
  const [activeCampaigns, liveProducts, tierCounts] = await Promise.all([
    prisma.campaign.count({ where: { shopId, status: "ACTIVE" } }),
    prisma.campaignProduct.findMany({
      where: { shopId, campaign: { status: "ACTIVE" } },
      distinct: ["productGid"],
      select: { productGid: true },
    }),
    prisma.quantityTier.groupBy({
      by: ["campaignId"],
      where: { campaign: { shopId, status: { not: "ARCHIVED" } } },
      _count: { _all: true },
    }),
  ]);
  return {
    activeCampaigns,
    liveProducts: liveProducts.length,
    mostTiers: tierCounts.reduce((max, t) => Math.max(max, t._count._all), 0),
  };
}

/** Shopify-hosted plan selection page. Null until SHOPIFY_APP_HANDLE is set. */
export function planSelectionUrl(domain: string): string | null {
  const appHandle = env().SHOPIFY_APP_HANDLE;
  if (!appHandle) return null;
  const storeHandle = domain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

/**
 * app_subscriptions/update (sent for Billing API subscriptions): mark the
 * cached plan stale so the next request re-checks it with Shopify.
 */
export async function applySubscriptionWebhook(domain: string) {
  const shop = await prisma.shop.findUnique({ where: { domain } });
  if (!shop) return;
  await prisma.billingSubscription.updateMany({
    where: { shopId: shop.id },
    data: { lastCheckedAt: null },
  });
}
