import { adminQuery, type AdminGraphqlClient } from "./graphql";

/**
 * Reads the app's active subscription for the current shop from the Admin
 * API. This reflects subscriptions created through the Billing API. For apps
 * on Shopify App Pricing (managed pricing) Shopify documents the Partner API
 * as the authoritative source; see docs/ARCHITECTURE.md#billing.
 */
const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query BundleBoostActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
      }
    }
  }`;

export type ShopifySubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
};

export async function fetchActiveSubscription(
  admin: AdminGraphqlClient,
): Promise<ShopifySubscription | null> {
  const data = await adminQuery<{
    currentAppInstallation: { activeSubscriptions: ShopifySubscription[] };
  }>(admin, ACTIVE_SUBSCRIPTIONS_QUERY);
  return data.currentAppInstallation.activeSubscriptions[0] ?? null;
}
