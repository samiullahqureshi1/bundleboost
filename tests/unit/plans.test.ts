import { describe, expect, it } from "vitest";
import { applyWidgetPlan, planFor, planFromHandle, PLANS, WIDGET_DEFAULTS } from "../../app/lib/plans";

describe("plans", () => {
  it("matches the published plan sheet", () => {
    expect(PLANS.free).toMatchObject({ price: 0, activeCampaigns: 1, liveProducts: 5, tiersPerCampaign: 3 });
    expect(PLANS.growth).toMatchObject({ price: 7.99, activeCampaigns: 10, liveProducts: 100, tiersPerCampaign: 10 });
    expect(PLANS.pro).toMatchObject({ price: 14.99, activeCampaigns: 25, liveProducts: null, tiersPerCampaign: 20 });
  });

  it("treats unknown or missing handles as Free", () => {
    expect(planFromHandle("growth").name).toBe("Growth");
    expect(planFromHandle("enterprise").handle).toBe("free");
    expect(planFromHandle(null).handle).toBe("free");
  });

  it("finds the smallest plan that allows something", () => {
    expect(planFor((p) => p.tiersPerCampaign >= 5)?.handle).toBe("growth");
    expect(planFor((p) => p.tiersPerCampaign >= 15)?.handle).toBe("pro");
    expect(planFor((p) => p.activeCampaigns >= 100)).toBeNull();
  });

  it("publishes default widget styling for settings a plan doesn't include", () => {
    const custom = {
      heading: "Stock up",
      layout: "GRID",
      accentColor: "#112233",
      textColor: "#445566",
      backgroundColor: "#000000",
      borderRadius: 20,
      showSavings: false,
      highlightBestDeal: false,
    };
    expect(applyWidgetPlan(custom, PLANS.free)).toEqual({ ...WIDGET_DEFAULTS, heading: "Stock up" });
    expect(applyWidgetPlan(custom, PLANS.growth)).toMatchObject({
      layout: "GRID",
      accentColor: "#112233",
      textColor: WIDGET_DEFAULTS.textColor,
      borderRadius: WIDGET_DEFAULTS.borderRadius,
    });
    expect(applyWidgetPlan(custom, PLANS.pro)).toEqual(custom);
  });
});
