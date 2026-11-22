import type { ActionFunctionArgs } from "react-router";
import { logger } from "../.server/logger";
import { findShopByDomain } from "../.server/services/shop.service";
import { syncContractFromShopify } from "../.server/services/subscription-contract.service";
import { handleWebhook } from "../.server/webhooks";

/**
 * subscription_contracts/create and /update: keep BundleBoost's copy of each
 * subscription (status, next renewal, customer, items) in step with Shopify.
 */
export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop, admin, payload }) => {
    const contractGid = (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id;
    const record = await findShopByDomain(shop);
    if (!contractGid || !record || !admin) {
      logger.warn("Skipping subscription contract webhook", { shop, hasAdmin: Boolean(admin) });
      return;
    }
    await syncContractFromShopify(admin, record.id, contractGid);
  });
