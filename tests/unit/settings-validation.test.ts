import { describe, expect, it } from "vitest";
import { WIDGET_DEFAULTS } from "../../app/lib/plans";
import { shopSettingsSchema, widgetSettingsSchema } from "../../app/lib/settings-validation";

const widget = {
  ...WIDGET_DEFAULTS,
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

  it("validates the new customization options", () => {
    expect(widgetSettingsSchema.safeParse({ ...widget, buyLabel: "Buy more" }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, badgeText: "" }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, spacing: "HUGE" }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, headingSize: 40 }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, textSize: 8 }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, badgeColor: "blue" }).success).toBe(false);
    const ok = widgetSettingsSchema.parse({ ...widget, showPricePerItem: "false", spacing: "COMPACT", subheading: "" });
    expect(ok.showPricePerItem).toBe(false);
    expect(ok.spacing).toBe("COMPACT");
  });
});

describe("purchase options settings", () => {
  it("accepts the defaults and coerces the toggle", () => {
    const result = widgetSettingsSchema.parse({ ...widget, showPurchaseOptions: "false" });
    expect(result.showPurchaseOptions).toBe(false);
    expect(result.subscribeLabel).toBe("Subscribe & save {discount}");
  });

  it("requires short, non-empty labels", () => {
    expect(widgetSettingsSchema.safeParse({ ...widget, oneTimeLabel: " " }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, subscribeLabel: "x".repeat(51) }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, frequencyLabel: "" }).success).toBe(false);
  });
});

describe("subscription frequency overrides", () => {
  it("keeps names and hidden flags, and drops entries that change nothing", () => {
    const result = widgetSettingsSchema.parse({
      ...widget,
      planOverrides: { "101": { label: " Quarterly " }, "102": { hidden: true }, "103": { label: "", hidden: false } },
    });
    expect(result.planOverrides).toEqual({ "101": { label: "Quarterly" }, "102": { hidden: true } });
  });

  it("rejects non-numeric plan ids and long names", () => {
    expect(widgetSettingsSchema.safeParse({ ...widget, planOverrides: { abc: { label: "x" } } }).success).toBe(false);
    expect(widgetSettingsSchema.safeParse({ ...widget, planOverrides: { "1": { label: "x".repeat(61) } } }).success).toBe(false);
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
