import { adminQuery, type AdminGraphqlClient } from "./graphql";
import { ShopifyApiError } from "../errors";

/**
 * Reads the app's active subscription for the current shop from the Admin
 * API. This reflects subscriptions created through the Shopify Billing API.
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

const CANCEL_SUBSCRIPTION_MUTATION = `#graphql
  mutation BundleBoostSubscriptionCancel($id: ID!, $prorate: Boolean) {
    appSubscriptionCancel(id: $id, prorate: $prorate) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
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
  const subs = data.currentAppInstallation.activeSubscriptions ?? [];
  return subs.find((s) => s.status === "ACTIVE") ?? subs[0] ?? null;
}

export async function cancelSubscription(
  admin: AdminGraphqlClient,
  subscriptionId: string,
  prorate = true,
): Promise<{ id: string; status: string } | null> {
  const result = await adminQuery<{
    appSubscriptionCancel: {
      appSubscription: { id: string; status: string } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(admin, CANCEL_SUBSCRIPTION_MUTATION, {
    id: subscriptionId,
    prorate,
  });

  if (result.appSubscriptionCancel.userErrors.length > 0) {
    const errorMsg = result.appSubscriptionCancel.userErrors.map((e) => e.message).join(", ");
    throw new ShopifyApiError(`Failed to cancel subscription: ${errorMsg}`);
  }

  return result.appSubscriptionCancel.appSubscription;
}
