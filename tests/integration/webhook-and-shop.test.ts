import { beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhookOnce } from "../../app/.server/services/webhook.service";
import {
  markShopUninstalled,
  onShopAuthenticated,
  redactShop,
} from "../../app/.server/services/shop.service";
import { applySubscriptionWebhook } from "../../app/.server/services/billing.service";
import { createDraftCampaign } from "../../app/.server/services/campaign.service";
import { PLANS } from "../../app/lib/plans";
import { createAdminDouble, fakeProduct, productGid } from "../support/admin-graphql-double";
import { createShop, prisma, resetDatabase } from "../support/db";

const DOMAIN = "shop-a.myshopify.com";

beforeEach(resetDatabase);

async function addSession(shop: string) {
  await prisma.session.create({
    data: { id: `offline_${shop}`, shop, state: "x", accessToken: "shpat_test", isOnline: false },
  });
}

describe("processWebhookOnce", () => {
  const meta = { webhookId: "wh-1", shop: DOMAIN, topic: "APP_UNINSTALLED" };

  it("runs the handler once per delivery id", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    expect(await processWebhookOnce(meta, handler)).toBe("processed");
    expect(await processWebhookOnce(meta, handler)).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { webhookId: "wh-1" } });
    expect(row.status).toBe("PROCESSED");
    expect(row.processedAt).toBeInstanceOf(Date);
  });

  it("handles concurrent duplicate deliveries", async () => {
    const handler = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const outcomes = await Promise.all([
      processWebhookOnce(meta, handler),
      processWebhookOnce(meta, handler),
      processWebhookOnce(meta, handler),
    ]);
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("records failures and lets a retry succeed", async () => {
    await expect(
      processWebhookOnce(meta, async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
    const failed = await prisma.webhookEvent.findUniqueOrThrow({ where: { webhookId: "wh-1" } });
    expect(failed).toMatchObject({ status: "FAILED", error: "db down" });

    const retry = vi.fn().mockResolvedValue(undefined);
    expect(await processWebhookOnce(meta, retry)).toBe("processed");
    expect(retry).toHaveBeenCalledOnce();
  });

  it("re-claims a stale in-flight delivery", async () => {
    await prisma.webhookEvent.create({
      data: {
        webhookId: meta.webhookId,
        topic: meta.topic,
        shopDomain: DOMAIN,
        status: "PROCESSING",
        receivedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    expect(await processWebhookOnce(meta, handler)).toBe("processed");
  });

  it("does not re-claim a recent in-flight delivery", async () => {
    await prisma.webhookEvent.create({
      data: { webhookId: meta.webhookId, topic: meta.topic, shopDomain: DOMAIN, status: "PROCESSING" },
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    expect(await processWebhookOnce(meta, handler)).toBe("duplicate");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("shop lifecycle", () => {
  it("creates the tenant with default settings on first authentication", async () => {
    const { client } = createAdminDouble([]);
    const shop = await onShopAuthenticated(DOMAIN, client);
    expect(shop).toMatchObject({ domain: DOMAIN, name: "Test Shop", currencyCode: "EUR", uninstalledAt: null });
    expect(await prisma.shopSettings.count({ where: { shopId: shop.id } })).toBe(1);
    expect(await prisma.widgetSettings.count({ where: { shopId: shop.id } })).toBe(1);
    expect(await prisma.billingSubscription.count({ where: { shopId: shop.id } })).toBe(1);
  });

  it("uninstall revokes sessions but keeps configuration; reinstall reactivates", async () => {
    const shop = await createShop(DOMAIN);
    await addSession(DOMAIN);
    await addSession("other.myshopify.com");
    const { client } = createAdminDouble([fakeProduct(1)]);
    await createDraftCampaign(
      { shopId: shop.id, actorId: null, admin: client, plan: PLANS.pro },
      { name: "Keep me", discountType: "PERCENTAGE", products: [{ productGid: productGid(1) }], tiers: [{ minQuantity: 2, value: "5" }] },
    );

    await markShopUninstalled(DOMAIN);
    await markShopUninstalled(DOMAIN); // idempotent

    expect(await prisma.session.count({ where: { shop: DOMAIN } })).toBe(0);
    expect(await prisma.session.count({ where: { shop: "other.myshopify.com" } })).toBe(1);
    expect((await prisma.shop.findUniqueOrThrow({ where: { domain: DOMAIN } })).uninstalledAt).toBeInstanceOf(Date);
    expect(await prisma.campaign.count({ where: { shopId: shop.id } })).toBe(1);

    await onShopAuthenticated(DOMAIN, client);
    expect((await prisma.shop.findUniqueOrThrow({ where: { domain: DOMAIN } })).uninstalledAt).toBeNull();
  });

  it("shop/redact erases every row for the shop only", async () => {
    const shop = await createShop(DOMAIN);
    const other = await createShop("other.myshopify.com");
    await addSession(DOMAIN);
    const { client } = createAdminDouble([fakeProduct(1)]);
    for (const s of [shop, other]) {
      await createDraftCampaign(
        { shopId: s.id, actorId: null, admin: client, plan: PLANS.pro },
        { name: "C", discountType: "PERCENTAGE", products: [{ productGid: productGid(1) }], tiers: [{ minQuantity: 2, value: "5" }] },
      );
    }

    await redactShop(DOMAIN);

    expect(await prisma.shop.count({ where: { domain: DOMAIN } })).toBe(0);
    expect(await prisma.session.count({ where: { shop: DOMAIN } })).toBe(0);
    expect(await prisma.campaign.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await prisma.widgetSettings.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await prisma.campaign.count({ where: { shopId: other.id } })).toBe(1);
  });
});

describe("applySubscriptionWebhook", () => {
  it("marks the cached plan stale so the next request re-checks with Shopify", async () => {
    const shop = await createShop(DOMAIN);
    await prisma.billingSubscription.update({
      where: { shopId: shop.id },
      data: { planName: "growth", status: "ACTIVE", lastCheckedAt: new Date() },
    });
    await applySubscriptionWebhook(DOMAIN);
    expect(await prisma.billingSubscription.findUniqueOrThrow({ where: { shopId: shop.id } })).toMatchObject({
      planName: "growth",
      status: "ACTIVE",
      lastCheckedAt: null,
    });
  });

  it("ignores webhooks for unknown shops", async () => {
    await expect(applySubscriptionWebhook("ghost.myshopify.com")).resolves.toBeUndefined();
  });
});
