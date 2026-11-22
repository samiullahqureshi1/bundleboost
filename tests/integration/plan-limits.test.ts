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
  it("is Free and configured when there is no active subscription", async () => {
    const result = await getShopPlan(shopId, free.admin);
    expect(result).toMatchObject({ configured: true, verified: true, plan: { handle: "free" } });
  });

  it("detects an active Growth subscription from Shopify", async () => {
    const adminWithSub = createAdminDouble(catalog);
    adminWithSub.setActiveSubscriptions([
      {
        id: "gid://shopify/AppSubscription/123",
        name: "Growth",
        status: "ACTIVE",
        test: true,
        trialDays: 0,
        currentPeriodEnd: "2026-12-31T00:00:00Z",
      },
    ]);
    const result = await getShopPlan(shopId, adminWithSub.client, { fresh: true });
    expect(result).toMatchObject({
      configured: true,
      verified: true,
      plan: { handle: "growth" },
      renewsAt: "2026-12-31T00:00:00Z",
    });
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

  it("lets Free change its own options but not Growth ones", async () => {
    await expect(
      updateWidgetSettings({ shopId, actorId: null, plan: PLANS.free }, { ...base, accentColor: "#112233" }),
    ).resolves.toMatchObject({ heading: "Stock up", accentColor: "#112233" });
    const error = await updateWidgetSettings(
      { shopId, actorId: null, plan: PLANS.free },
      { ...base, borderRadius: 20 },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.borderRadius).toMatch(/Upgrade to Growth/);
  });

  it("keeps font sizes and detailed colours for Pro", async () => {
    await expect(
      updateWidgetSettings({ shopId, actorId: null, plan: PLANS.growth }, { ...base, spacing: "COMPACT", borderRadius: 20 }),
    ).resolves.toMatchObject({ spacing: "COMPACT", borderRadius: 20 });
    const error = await updateWidgetSettings(
      { shopId, actorId: null, plan: PLANS.growth },
      { ...base, headingSize: 24 },
    ).catch((e) => e);
    expect((error as ValidationError).fieldErrors.headingSize).toMatch(/Upgrade to Pro/);
  });

  it("lets a lower plan reset an option it no longer includes", async () => {
    await updateWidgetSettings({ shopId, actorId: null, plan: PLANS.pro }, { ...base, headingSize: 24, badgeColor: "#00FF00" });
    await expect(updateWidgetSettings({ shopId, actorId: null, plan: PLANS.free }, base)).resolves.toMatchObject({
      headingSize: WIDGET_DEFAULTS.headingSize,
      badgeColor: WIDGET_DEFAULTS.badgeColor,
    });
  });

  it("publishes every option on Pro and defaults for locked ones after a downgrade", async () => {
    await updateWidgetSettings(
      { shopId, actorId: null, plan: PLANS.pro },
      { ...base, borderRadius: 20, subheading: "At checkout", headingSize: 22, badgeColor: "#00FF00", spacing: "COMPACT" },
    );
    // No cached paid plan -> Free.
    expect((await buildStorefrontConfig(shopId)).widget).toMatchObject({
      heading: "Stock up",
      subheading: "At checkout",
      border_radius: WIDGET_DEFAULTS.borderRadius,
      heading_size: WIDGET_DEFAULTS.headingSize,
      badge_color: WIDGET_DEFAULTS.badgeColor,
      spacing: "comfortable",
    });
    await prisma.billingSubscription.upsert({
      where: { shopId },
      create: { shopId, planName: "pro", status: "ACTIVE" },
      update: { planName: "pro", status: "ACTIVE" },
    });
    expect((await buildStorefrontConfig(shopId)).widget).toMatchObject({
      border_radius: 20,
      heading_size: 22,
      badge_color: "#00FF00",
      spacing: "compact",
    });
  });

  it("publishes frequency names on Growth, but not on Free", async () => {
    const overrides = { "101": { label: "Quarterly" }, "102": { hidden: true } };
    const error = await updateWidgetSettings(
      { shopId, actorId: null, plan: PLANS.free },
      { ...base, planOverrides: overrides },
    ).catch((e) => e);
    expect((error as ValidationError).fieldErrors.planOverrides).toMatch(/Upgrade to Growth/);

    await updateWidgetSettings({ shopId, actorId: null, plan: PLANS.growth }, { ...base, planOverrides: overrides });
    await prisma.billingSubscription.upsert({
      where: { shopId },
      create: { shopId, planName: "growth", status: "ACTIVE" },
      update: { planName: "growth", status: "ACTIVE" },
    });
    expect((await buildStorefrontConfig(shopId)).widget.plan_overrides).toEqual(overrides);
  });

  it("rejects a tier label without {quantity}", async () => {
    const error = await updateWidgetSettings(
      { shopId, actorId: null, plan: PLANS.free },
      { ...base, buyLabel: "Buy more" },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.buyLabel).toBeTruthy();
  });
});
