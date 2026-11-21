import prisma from "../../app/db.server";

/** Truncates every application table between tests. */
export async function resetDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("resetDatabase() may only run against a *_test database");
  }
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "AuditLog", "WebhookEvent", "BillingSubscription",
      "WidgetSettings", "QuantityTier", "CampaignVariant", "CampaignProduct",
      "Campaign", "ShopSettings", "Shop", "Session" CASCADE
  `);
}

export async function createShop(domain: string) {
  return prisma.shop.create({
    data: {
      domain,
      name: domain,
      currencyCode: "USD",
      settings: { create: {} },
      widgetSettings: { create: {} },
      subscription: { create: {} },
    },
  });
}

export { prisma };
