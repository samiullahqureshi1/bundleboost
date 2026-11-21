import { beforeEach, describe, expect, it } from "vitest";
import {
  changeCampaignStatus,
  createDraftCampaign,
  updateCampaign,
  PlanLimitError,
  type TenantContext,
} from "../../app/.server/services/campaign.service";
import { getShopPlan, getUsage } from "../../app/.server/services/billing.service";
import { updateWidgetSettings } from "../../app/.server/services/settings.service";
import { buildStorefrontConfig } from "../../app/.server/services/storefront-sync.service";
import { ValidationError } from "../../app/.server/errors";
import { PLANS, WIDGET_DEFAULTS } from "../../app/lib/plans";
import { createAdminDouble, fakeProduct, productGid } from "../support/admin-graphql-double";
import { createShop, prisma, resetDatabase } from "../support/db";

const catalog = Array.from({ length: 8 }, (_, i) => fakeProduct(i + 1, 1));

function input(products: number[], tiers = 2, name = "Campaign") {
  return {
    name,
    discountType: "PERCENTAGE",
    products: products.map((n) => ({ productGid: productGid(n), variantGids: [] })),
    tiers: Array.from({ length: tiers }, (_, i) => ({ minQuantity: i + 2, value: String(i + 1) })),
  };
}

let shopId: string;
let free: TenantContext;
let growth: TenantContext;

beforeEach(async () => {
  await resetDatabase();
  const shop = await createShop("limits.myshopify.com");
  shopId = shop.id;
  const admin = createAdminDouble(catalog).client;
  free = { shopId, actorId: null, admin, plan: PLANS.free };
  growth = { shopId, actorId: null, admin, plan: PLANS.growth };
});

describe("tier limits", () => {
  it("caps tiers per campaign by plan, naming the plan that allows more", async () => {
    const error = await createDraftCampaign(free, input([1], 4)).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.tiers).toMatch(/Free plan allows 3 tiers.*Upgrade to Growth/);
    await expect(createDraftCampaign(growth, input([1], 4))).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("re-checks tiers on edit and on activation after a downgrade", async () => {
    const c = await createDraftCampaign(growth, input([1], 5));
    await expect(updateCampaign(free, c.id, input([1], 5))).rejects.toBeInstanceOf(ValidationError);
    await expect(changeCampaignStatus(free, c.id, "ACTIVE")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("live limits", () => {
  it("allows one active campaign on Free", async () => {
    const a = await createDraftCampaign(free, input([1], 2, "A"));
    const b = await createDraftCampaign(free, input([2], 2, "B"));
    await changeCampaignStatus(free, a.id, "ACTIVE");
    const error = await changeCampaignStatus(free, b.id, "ACTIVE").catch((e) => e);
    expect(error).toBeInstanceOf(PlanLimitError);
    expect((error as Error).message).toMatch(/1 active campaign.*Upgrade to Growth/);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("DRAFT");

    await expect(changeCampaignStatus(growth, b.id, "ACTIVE")).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("caps live products on Free, at activation and when editing a live campaign", async () => {
    const tooMany = await createDraftCampaign(free, input([1, 2, 3, 4, 5, 6]));
    await expect(changeCampaignStatus(free, tooMany.id, "ACTIVE")).rejects.toBeInstanceOf(PlanLimitError);

    const ok = await createDraftCampaign(free, input([1, 2, 3]));
    await changeCampaignStatus(free, ok.id, "ACTIVE");
    const error = await updateCampaign(free, ok.id, input([1, 2, 3, 4, 5, 6])).catch((e) => e);
    expect(error).toBeInstanceOf(PlanLimitError);
    expect((error as Error).message).toMatch(/5 products; this would make 6 live/);
  });

  it("pausing frees a slot", async () => {
    const a = await createDraftCampaign(free, input([1], 2, "A"));
    const b = await createDraftCampaign(free, input([2], 2, "B"));
    await changeCampaignStatus(free, a.id, "ACTIVE");
    await changeCampaignStatus(free, a.id, "PAUSED");
    await expect(changeCampaignStatus(free, b.id, "ACTIVE")).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("reports usage against the plan", async () => {
    const a = await createDraftCampaign(growth, input([1, 2], 4, "A"));
    await createDraftCampaign(growth, input([3], 2, "B"));
    await changeCampaignStatus(growth, a.id, "ACTIVE");
    expect(await getUsage(shopId)).toEqual({ activeCampaigns: 1, liveProducts: 2, mostTiers: 4 });
  });
});

describe("plan lookup", () => {
  it("is Free and unconfigured without Partner API credentials", async () => {
    const result = await getShopPlan(shopId, free.admin);
    expect(result).toMatchObject({ configured: false, verified: false, plan: { handle: "free" } });
  });

  it("falls back to the last known plan from the cache", async () => {
    await prisma.billingSubscription.update({
      where: { shopId },
      data: { planName: "growth", status: "ACTIVE", lastCheckedAt: new Date() },
    });
    expect((await getShopPlan(shopId, free.admin)).plan.handle).toBe("growth");
  });
});

describe("widget limits", () => {
  const base = { ...WIDGET_DEFAULTS, heading: "Stock up" };

  it("lets Free change the heading but not the styling", async () => {
    await expect(
      updateWidgetSettings({ shopId, actorId: null, plan: PLANS.free }, base),
    ).resolves.toMatchObject({ heading: "Stock up" });
    const error = await updateWidgetSettings(
      { shopId, actorId: null, plan: PLANS.free },
      { ...base, accentColor: "#112233" },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.accentColor).toMatch(/Upgrade to Growth/);
  });

  it("lets Pro change everything", async () => {
    await expect(
      updateWidgetSettings(
        { shopId, actorId: null, plan: PLANS.pro },
        { ...base, accentColor: "#112233", backgroundColor: "#000000", borderRadius: 20 },
      ),
    ).resolves.toMatchObject({ borderRadius: 20 });
  });

  it("publishes default styling to the storefront after a downgrade", async () => {
    await updateWidgetSettings(
      { shopId, actorId: null, plan: PLANS.pro },
      { ...base, accentColor: "#112233", borderRadius: 20 },
    );
    // No cached paid plan -> Free.
    const config = await buildStorefrontConfig(shopId);
    expect(config.widget).toMatchObject({
      heading: "Stock up",
      accent_color: WIDGET_DEFAULTS.accentColor,
      border_radius: WIDGET_DEFAULTS.borderRadius,
    });

    await prisma.billingSubscription.update({ where: { shopId }, data: { planName: "pro", status: "ACTIVE" } });
    expect((await buildStorefrontConfig(shopId)).widget).toMatchObject({ accent_color: "#112233", border_radius: 20 });
  });
});
