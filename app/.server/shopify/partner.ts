import { env } from "../env";
import { ShopifyApiError } from "../errors";
import { adminQuery, type AdminGraphqlClient } from "./graphql";

/**
 * Shopify App Pricing: a merchant's subscription comes from the Partner API's
 * activeSubscription query, not the Admin API. Validated against Partner API
 * 2026-10.
 */
const PARTNER_API_VERSION = "2026-10";

const ACTIVE_SUBSCRIPTION = `query BundleBoostActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    trialEndsAt
    currentBillingCycle {
      startTime
      endTime
    }
    items {
      handle
      description
      price {
        __typename
        ... on FlatRatePrice {
          amount
        }
      }
    }
    pendingUpdate {
      items {
        handle
      }
    }
  }
}`;

const SHOP_ID = `#graphql
  query BundleBoostShopId {
    shop {
      id
    }
  }`;

export type PartnerSubscription = {
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: { handle: string | null; description: string | null }[];
  pendingUpdate: { items: { handle: string | null }[] } | null;
};

export function partnerApiConfigured() {
  const config = env();
  return Boolean(config.SHOPIFY_PARTNER_ORG_ID && config.SHOPIFY_PARTNER_API_ACCESS_TOKEN && config.SHOPIFY_APP_GID);
}

/**
 * The shop's active subscription, or null when it has none. Throws on
 * throttling or any failure, so a failed check never downgrades a paying
 * merchant (callers keep the last known plan instead).
 */
export async function fetchActiveSubscription(admin: AdminGraphqlClient): Promise<PartnerSubscription | null> {
  const config = env();
  if (!partnerApiConfigured()) throw new ShopifyApiError("Partner API isn't configured.");

  const { shop } = await adminQuery<{ shop: { id: string } }>(admin, SHOP_ID);
  const response = await fetch(
    `https://partners.shopify.com/${config.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.SHOPIFY_PARTNER_API_ACCESS_TOKEN!,
      },
      body: JSON.stringify({
        query: ACTIVE_SUBSCRIPTION,
        variables: { appId: config.SHOPIFY_APP_GID, shopId: shop.id },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    data?: { activeSubscription: PartnerSubscription | null };
    errors?: unknown;
  };
  if (!response.ok || body.errors || !body.data) {
    throw new ShopifyApiError(`Partner API request failed (HTTP ${response.status}).`);
  }
  return body.data.activeSubscription;
}
