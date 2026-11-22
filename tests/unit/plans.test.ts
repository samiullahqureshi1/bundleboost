import { describe, expect, it } from "vitest";
import { applyWidgetPlan, planFor, planFromHandle, PLANS, sameSetting, WIDGET_DEFAULTS } from "../../app/lib/plans";

describe("plans", () => {
  it("matches the published plan sheet", () => {
    expect(PLANS.free).toMatchObject({ price: 0, activeCampaigns: 1, liveProducts: 5, tiersPerCampaign: 3 });
    expect(PLANS.growth).toMatchObject({ price: 7.99, activeCampaigns: 10, liveProducts: 100, tiersPerCampaign: 10 });
    expect(PLANS.pro).toMatchObject({ price: 14.99, activeCampaigns: 25, liveProducts: null, tiersPerCampaign: 20 });
  });

  it("treats unknown or missing handles as Free and handles case insensitivity", () => {
    expect(planFromHandle("growth").name).toBe("Growth");
    expect(planFromHandle("Growth").handle).toBe("growth");
    expect(planFromHandle("pro").name).toBe("Pro");
    expect(planFromHandle("Pro").handle).toBe("pro");
    expect(planFromHandle("enterprise").handle).toBe("free");
    expect(planFromHandle(null).handle).toBe("free");
  });

  it("finds the smallest plan that allows something", () => {
    expect(planFor((p) => p.tiersPerCampaign >= 5)?.handle).toBe("growth");
    expect(planFor((p) => p.tiersPerCampaign >= 15)?.handle).toBe("pro");
    expect(planFor((p) => p.activeCampaigns >= 100)).toBeNull();
  });

  it("splits widget options across plans, each including the one below", () => {
    expect(PLANS.free.widget).toEqual(
      expect.arrayContaining(["heading", "subheading", "layout", "showSavings", "highlightBestDeal", "accentColor"]),
    );
    expect(PLANS.free.widget).not.toContain("borderRadius");
    expect(PLANS.free.widget).toContain("showPurchaseOptions");
    expect(PLANS.free.widget).not.toContain("subscribeLabel");
    expect(PLANS.growth.widget).toEqual(expect.arrayContaining(["oneTimeLabel", "subscribeLabel", "frequencyLabel"]));
    expect(PLANS.growth.widget).toEqual(expect.arrayContaining([...PLANS.free.widget, "buyLabel", "spacing", "textColor"]));
    expect(PLANS.growth.widget).not.toContain("headingSize");
    expect(PLANS.pro.widget).toEqual(expect.arrayContaining([...PLANS.growth.widget, "headingSize", "badgeColor"]));
    expect(PLANS.pro.widget).toHaveLength(Object.keys(WIDGET_DEFAULTS).length);
  });

  it("publishes defaults for options above the shop's plan", () => {
    const custom = {
      ...WIDGET_DEFAULTS,
      heading: "Stock up",
      accentColor: "#112233",
      borderRadius: 20,
      spacing: "SPACIOUS",
      headingSize: 22,
      badgeColor: "#00FF00",
    };
    expect(applyWidgetPlan(custom, PLANS.free)).toEqual({ ...WIDGET_DEFAULTS, heading: "Stock up", accentColor: "#112233" });
    expect(applyWidgetPlan(custom, PLANS.growth)).toEqual({
      ...WIDGET_DEFAULTS,
      heading: "Stock up",
      accentColor: "#112233",
      borderRadius: 20,
      spacing: "SPACIOUS",
    });
    expect(applyWidgetPlan(custom, PLANS.pro)).toEqual(custom);
  });

  it("falls back to defaults for fields a plan doesn't include", () => {
    const restricted = { ...PLANS.free, widget: ["heading" as const] };
    const custom = { ...WIDGET_DEFAULTS, heading: "Stock up", accentColor: "#112233", badgeText: "Popular" };
    expect(applyWidgetPlan(custom, restricted)).toEqual({ ...WIDGET_DEFAULTS, heading: "Stock up" });
  });

  it("compares settings including colours and plan overrides", () => {
    expect(sameSetting("#ABCDEF", "#abcdef")).toBe(true);
    expect(sameSetting({}, {})).toBe(true);
    expect(sameSetting({ "1": { hidden: true } }, {})).toBe(false);
    expect(PLANS.free.widget).not.toContain("planOverrides");
    expect(PLANS.growth.widget).toContain("planOverrides");
  });
});
