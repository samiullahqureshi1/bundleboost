import type { ActionFunctionArgs } from "react-router";
import { handleWebhook } from "../.server/webhooks";
import { applySubscriptionWebhook } from "../.server/services/billing.service";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop }) => {
    await applySubscriptionWebhook(shop);
  });
