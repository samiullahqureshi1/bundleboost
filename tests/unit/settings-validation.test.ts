import { describe, expect, it } from "vitest";
import { shopSettingsSchema, widgetSettingsSchema } from "../../app/lib/settings-validation";

const widget = {
  heading: "Buy more, save more",
  layout: "STACKED",
  accentColor: "#008060",
  textColor: "#202223",
  backgroundColor: "#FFFFFF",
  borderRadius: 8,
  showSavings: true,
  highlightBestDeal: "false",
};

describe("widgetSettingsSchema", () => {
  it("accepts valid settings and coerces form booleans", () => {
    const result = widgetSettingsSchema.parse(widget);
    expect(result.highlightBestDeal).toBe(false);
    expect(result.showSavings).toBe(true);
  });

  it("rejects invalid colours, layouts and radii", () => {
    expect(widgetSettingsSchema.safeParse({ ...widget, accentColor: "red" }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, accentColor: "#fff" }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, layout: "CAROUSEL" }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, borderRadius: 40 }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, heading: "" }).success).toBe(false);
  });
});

describe("shopSettingsSchema", () => {
  it("validates the default label", () => {
    const base = {
      defaultDiscountLabel: "Volume discount",
      combineWithProductDiscounts: false,
      combineWithOrderDiscounts: "on",
      combineWithShippingDiscounts: true,
    };
    expect(shopSettingsSchema.parse(base).combineWithOrderDiscounts).toBe(true);
    expect(shopSettingsSchema.safeParse({ ...base, defaultDiscountLabel: "  " }).success).toBe(false);
  });
});
