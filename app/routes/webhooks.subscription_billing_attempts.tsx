import type { ActionFunctionArgs } from "react-router";
import { logger } from "../.server/logger";
import { findShopByDomain } from "../.server/services/shop.service";
import { handleBillingAttemptWebhook } from "../.server/services/subscription-contract.service";
import { handleWebhook } from "../.server/webhooks";

const TOPICS = {
  SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS: "success",
  SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE: "failure",
  SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED: "challenged",
} as const;

/**
 * Results of renewal charges BundleBoost started: success moves the
 * subscription to its next renewal; failure and challenged (3-D Secure)
 * schedule a retry or pause the subscription after the last attempt.
 */
export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop, admin, topic, payload }) => {
    const kind = TOPICS[String(topic) as keyof typeof TOPICS];
    const record = await findShopByDomain(shop);
    if (!kind || !record || !admin) {
      logger.warn("Skipping billing attempt webhook", { shop, topic });
      return;
    }
    await handleBillingAttemptWebhook(admin, record.id, kind, payload as Record<string, string | null>);
  });
