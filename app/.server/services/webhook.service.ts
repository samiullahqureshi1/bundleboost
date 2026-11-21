import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { logger } from "../logger";

export type WebhookMeta = {
  webhookId: string;
  shop: string;
  topic: string;
};

const STALE_CLAIM_MS = 5 * 60 * 1000;

export type WebhookOutcome = "processed" | "duplicate";

/**
 * Runs `handler` at most once per Shopify webhook delivery id.
 *
 * Shopify retries deliveries that don't get a 2xx within 5 seconds, and may
 * deliver the same event more than once. The unique `webhookId` row acts as
 * a claim: the first delivery inserts it and runs the handler; later
 * deliveries see PROCESSED (or an in-flight PROCESSING claim) and return
 * early. A FAILED claim is re-tried so Shopify's retry can succeed.
 */
export async function processWebhookOnce(
  meta: WebhookMeta,
  handler: () => Promise<void>,
): Promise<WebhookOutcome> {
  const claimed = await claim(meta);
  if (!claimed) {
    logger.info("Duplicate webhook ignored", { ...meta });
    return "duplicate";
  }

  try {
    await handler();
    await prisma.webhookEvent.update({
      where: { webhookId: meta.webhookId },
      data: { status: "PROCESSED", processedAt: new Date(), error: null },
    });
    logger.info("Webhook processed", { ...meta });
    return "processed";
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { webhookId: meta.webhookId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
      },
    });
    logger.error("Webhook handler failed", { ...meta, error });
    throw error;
  }
}

async function claim(meta: WebhookMeta): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        webhookId: meta.webhookId,
        shopDomain: meta.shop,
        topic: meta.topic,
        status: "PROCESSING",
      },
    });
    return true;
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
  }
  // Re-claim, atomically, a delivery that failed or whose worker died
  // mid-flight (PROCESSING for longer than any handler should take).
  const { count } = await prisma.webhookEvent.updateMany({
    where: {
      webhookId: meta.webhookId,
      OR: [
        { status: "FAILED" },
        {
          status: "PROCESSING",
          receivedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) },
        },
      ],
    },
    data: { status: "PROCESSING", error: null, receivedAt: new Date() },
  });
  return count === 1;
}
