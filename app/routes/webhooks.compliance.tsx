import type { ActionFunctionArgs } from "react-router";
import { logger } from "../.server/logger";
import { handleWebhook } from "../.server/webhooks";
import { redactShop } from "../.server/services/shop.service";
import {
  redactSubscriptionCustomer,
  subscriptionDataForCustomer,
} from "../.server/services/subscription-contract.service";

const customerGidOf = (payload: unknown) => {
  const id = (payload as { customer?: { id?: number | string } })?.customer?.id;
  return id ? `gid://shopify/Customer/${id}` : null;
};

/**
 * Mandatory GDPR/CPRA compliance webhooks (required for the App Store).
 *
 * The only customer data BundleBoost holds is on subscriptions bought on its
 * plans (customer id, name, email, origin order). customers/redact erases
 * it; customers/data_request logs what's held so the merchant can provide
 * it. shop/redact erases every row the app holds for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ topic, shop, payload }) => {
    switch (String(topic)) {
      case "CUSTOMERS_DATA_REQUEST": {
        const customerGid = customerGidOf(payload);
        const subscriptions = customerGid ? await subscriptionDataForCustomer(shop, customerGid) : [];
        // Logged for the merchant to provide; no customer details in the log line.
        logger.info("Compliance data request", { shop, topic, subscriptions: subscriptions.length });
        return;
      }
      case "CUSTOMERS_REDACT": {
        const customerGid = customerGidOf(payload);
        const erased = customerGid ? await redactSubscriptionCustomer(shop, customerGid) : 0;
        logger.info("Compliance redaction", { shop, topic, subscriptions: erased });
        return;
      }
      case "SHOP_REDACT":
        await redactShop(shop);
        return;
      default:
        logger.warn("Unexpected compliance topic", { shop, topic });
    }
  });
