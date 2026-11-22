import { describe, expect, it } from "vitest";
import { frequencyName, frequencyOption, validateSubscriptionPlan } from "../../app/lib/subscription-plans";

const P = (n: number) => `gid://shopify/Product/${n}`;
const valid = (overrides: Record<string, unknown> = {}) => ({
  name: "Subscribe & save",
  frequencies: [{ interval: "MONTH", intervalCount: "3", discountPercent: "15", label: "Quarterly" }],
  productGids: [P(1)],
  ...overrides,
});

describe("subscription plan naming", () => {
  it("builds option values and default names", () => {
    expect(frequencyOption("MONTH", 3)).toBe("3 months");
    expect(frequencyOption("WEEK", 1)).toBe("1 week");
    expect(frequencyName("MONTH", 1)).toBe("Delivery every month");
    expect(frequencyName("DAY", 10)).toBe("Delivery every 10 days");
  });
});

describe("validateSubscriptionPlan", () => {
  it("accepts a quarterly plan and coerces numbers", () => {
    const result = validateSubscriptionPlan(valid());
    expect(result.success && result.data.frequencies[0]).toEqual({
      interval: "MONTH",
      intervalCount: 3,
      discountPercent: 15,
      label: "Quarterly",
    });
    expect(result.success && result.data.optionName).toBe("Delivery every");
  });

  it("rejects duplicates, out-of-range values and missing products", () => {
    const fail = (input: unknown) => {
      const r = validateSubscriptionPlan(input);
      if (r.success) throw new Error("expected failure");
      return r.fieldErrors;
    };
    const twice = { interval: "MONTH", intervalCount: 1, discountPercent: 10 };
    expect(fail(valid({ frequencies: [twice, twice] }))["frequencies.1.intervalCount"]).toMatch(/already/);
    expect(fail(valid({ frequencies: [{ ...twice, intervalCount: 25 }] }))["frequencies.0.intervalCount"]).toMatch(/24/);
    expect(fail(valid({ frequencies: [{ ...twice, discountPercent: 101 }] }))["frequencies.0.discountPercent"]).toBeTruthy();
    expect(fail(valid({ frequencies: [{ ...twice, interval: "HOUR" }] }))["frequencies.0.interval"]).toBeTruthy();
    expect(fail(valid({ productGids: [] })).productGids).toBeTruthy();
    expect(fail(valid({ frequencies: [] })).frequencies).toBeTruthy();
  });
});
