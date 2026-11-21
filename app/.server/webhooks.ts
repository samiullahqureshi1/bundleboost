import { authenticate } from "../shopify.server";
import { processWebhookOnce } from "./services/webhook.service";

type WebhookContext = Awaited<ReturnType<typeof authenticate.webhook>>;

/**
 * Shared webhook entry point:
 *  1. `authenticate.webhook` verifies the HMAC signature against the app
 *     secret and throws a 401 Response if it doesn't match.
 *  2. The delivery is de-duplicated by its webhook id.
 *  3. Handler errors return 500 so Shopify retries the delivery.
 */
export async function handleWebhook(
  request: Request,
  handler: (context: WebhookContext) => Promise<void>,
): Promise<Response> {
  const context = await authenticate.webhook(request);
  // Classic webhooks carry X-Shopify-Webhook-Id; event-style deliveries
  // carry an event id instead.
  const deliveryId = context.webhookId || context.eventId;
  if (!deliveryId) return new Response("Missing delivery id", { status: 400 });
  try {
    await processWebhookOnce(
      {
        webhookId: deliveryId,
        shop: context.shop,
        topic: String(context.topic),
      },
      () => handler(context),
    );
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 500 });
  }
}
