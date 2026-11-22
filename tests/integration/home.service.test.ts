import { WIDGET_DEFAULTS } from "../../app/lib/plans";
import { beforeEach, describe, expect, it } from "vitest";
import { getHomeData, updateSetupGuide } from "../../app/.server/services/home.service";
import { changeCampaignStatus, createDraftCampaign } from "../../app/.server/services/campaign.service";
import { updateWidgetSettings } from "../../app/.server/services/settings.service";
import { createAdminDouble, fakeProduct, productGid } from "../support/admin-graphql-double";
import { createShop, resetDatabase } from "../support/db";
import { PLANS, type Plan } from "../../app/lib/plans";

const input = (n: number) => ({
  name: `Campaign ${n}`,
  discountType: "PERCENTAGE",
  products: [{ productGid: productGid(n), variantGids: [] }],
  tiers: [{ minQuantity: 2, value: "5" }],
});

let shop: Awaited<ReturnType<typeof createShop>>;
let ctx: { shopId: string; actorId: null; admin: ReturnType<typeof createAdminDouble>["client"]; plan: Plan };

beforeEach(async () => {
  await resetDatabase();
  shop = await createShop("home.myshopify.com");
  ctx = { shopId: shop.id, actorId: null, admin: createAdminDouble([fakeProduct(1), fakeProduct(2)]).client, plan: PLANS.pro };
});

describe("getHomeData", () => {
  it("reports a brand-new shop as empty", async () => {
    const data = await getHomeData(shop);
    expect(data).toMatchObject({
      totalCampaigns: 0,
      liveCampaigns: 0,
      liveProducts: 0,
      firstDraftId: null,
      widgetCustomized: false,
      themeBlockConfirmed: false,
      setupGuideDismissed: false,
      recentCampaigns: [],
    });
    expect(data.themeEditorUrl).toContain("home.myshopify.com/admin/themes/current/editor");
    expect(data.themeEditorUrl).toContain("/quantity-breaks");
  });

  it("counts only active + synced campaigns as live, and links the oldest draft", async () => {
    const live = await createDraftCampaign(ctx, input(1));
    await changeCampaignStatus(ctx, live.id, "ACTIVE");
    const draft = await createDraftCampaign(ctx, input(2));

    const data = await getHomeData(shop);
    expect(data).toMatchObject({ totalCampaigns: 2, liveCampaigns: 1, liveProducts: 1, firstDraftId: draft.id });
    expect(data.counts).toEqual({ DRAFT: 1, ACTIVE: 1, PAUSED: 0, ARCHIVED: 0 });
    expect(data.recentCampaigns.map((c) => c.name)).toEqual(["Campaign 2", "Campaign 1"]);
  });

  it("marks the widget step done once the merchant saves widget settings", async () => {
    await updateWidgetSettings({ shopId: shop.id, actorId: null }, {
      ...WIDGET_DEFAULTS,
      heading: "Save more", layout: "GRID", accentColor: "#112233", textColor: "#000000",
      backgroundColor: "#FFFFFF", borderRadius: 4, showSavings: true, highlightBestDeal: false,
    });
    expect((await getHomeData(shop)).widgetCustomized).toBe(true);
  });

  it("persists setup-guide choices per shop", async () => {
    const other = await createShop("other.myshopify.com");
    await updateSetupGuide(shop.id, "confirmTheme");
    await updateSetupGuide(shop.id, "dismiss");
    expect(await getHomeData(shop)).toMatchObject({ themeBlockConfirmed: true, setupGuideDismissed: true });
    expect(await getHomeData(other)).toMatchObject({ themeBlockConfirmed: false, setupGuideDismissed: false });

    await updateSetupGuide(shop.id, "restore");
    await updateSetupGuide(shop.id, "unconfirmTheme");
    expect(await getHomeData(shop)).toMatchObject({ themeBlockConfirmed: false, setupGuideDismissed: false });
  });
});
