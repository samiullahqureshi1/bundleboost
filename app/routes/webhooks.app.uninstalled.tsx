import type { ActionFunctionArgs } from "react-router";
import { handleWebhook } from "../.server/webhooks";
import { markShopUninstalled } from "../.server/services/shop.service";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop }) => {
    // Idempotent: safe if the sessions were already removed.
    await markShopUninstalled(shop);
  });
