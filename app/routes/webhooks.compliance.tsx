import type { ActionFunctionArgs } from "react-router";
import { logger } from "../.server/logger";
import { handleWebhook } from "../.server/webhooks";
import { redactShop } from "../.server/services/shop.service";

/**
 * Mandatory GDPR/CPRA compliance webhooks (required for the App Store).
 *
 * BundleBoost stores no customer personal data — only shop-level campaign
 * configuration — so customer requests have nothing to export or erase.
 * They are still verified and recorded in the webhook ledger as evidence of
 * receipt. shop/redact erases every row the app holds for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ topic, shop }) => {
    switch (String(topic)) {
      case "CUSTOMERS_DATA_REQUEST":
      case "CUSTOMERS_REDACT":
        logger.info("Compliance request: no customer data stored", { shop, topic });
        return;
      case "SHOP_REDACT":
        await redactShop(shop);
        return;
      default:
        logger.warn("Unexpected compliance topic", { shop, topic });
    }
  });
