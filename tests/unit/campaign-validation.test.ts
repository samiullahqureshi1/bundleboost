import { describe, expect, it } from "vitest";
import {
  canTransition,
  findOverlappingProducts,
  validateCampaignInput,
} from "../../app/lib/campaign-validation";

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const V1 = "gid://shopify/ProductVariant/11";
const V2 = "gid://shopify/ProductVariant/12";

function valid(overrides: Record<string, unknown> = {}) {
  return {
    name: "Summer bundle",
    discountType: "PERCENTAGE",
    products: [{ productGid: P1, variantGids: [] }],
    tiers: [
      { minQuantity: 2, value: "5" },
      { minQuantity: 3, value: "10" },
    ],
    ...overrides,
  };
}

function errorsOf(input: unknown) {
  const result = validateCampaignInput(input);
  if (result.success) throw new Error("expected validation to fail");
  return result.fieldErrors;
}

describe("validateCampaignInput", () => {
  it("accepts a valid percentage campaign and normalises fields", () => {
    const result = validateCampaignInput(
      valid({ name: "  Trimmed  ", discountLabel: "", tiers: [{ minQuantity: "2", value: "7.5", label: "" }] }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("Trimmed");
    expect(result.data.discountLabel).toBeUndefined();
    expect(result.data.tiers[0]).toEqual({ minQuantity: 2, value: "7.5", label: undefined });
  });

  it("accepts a fixed-amount campaign with decimals", () => {
    expect(
      validateCampaignInput(
        valid({ discountType: "FIXED_AMOUNT", tiers: [{ minQuantity: 2, value: "150.25" }] }),
      ).success,
    ).toBe(true);
  });

  it("requires a name", () => {
    expect(errorsOf(valid({ name: "   " }))).toHaveProperty("name");
  });

  it("rejects names over 100 characters", () => {
    expect(errorsOf(valid({ name: "x".repeat(101) }))).toHaveProperty("name");
  });

  it("rejects unknown discount types", () => {
    expect(errorsOf(valid({ discountType: "BOGO" }))).toHaveProperty("discountType");
  });

  it("requires at least one product", () => {
    expect(errorsOf(valid({ products: [] }))).toHaveProperty("products");
  });

  it("rejects malformed product and variant IDs", () => {
    expect(errorsOf(valid({ products: [{ productGid: "123", variantGids: [] }] }))).toHaveProperty(
      "products.0.productGid",
    );
    expect(
      errorsOf(valid({ products: [{ productGid: P1, variantGids: ["gid://shopify/Product/9"] }] })),
    ).toHaveProperty("products.0.variantGids.0");
  });

  it("rejects duplicate products", () => {
    expect(
      errorsOf(valid({ products: [{ productGid: P1 }, { productGid: P1 }] })),
    ).toHaveProperty("products.1");
  });

  it("requires at least one tier and at most twenty (the highest plan's allowance)", () => {
    expect(errorsOf(valid({ tiers: [] }))).toHaveProperty("tiers");
    const tiers = (n: number) => Array.from({ length: n }, (_, i) => ({ minQuantity: i + 2, value: String(i + 1) }));
    expect(validateCampaignInput(valid({ tiers: tiers(20) })).success).toBe(true);
    expect(errorsOf(valid({ tiers: tiers(21) }))).toHaveProperty("tiers");
  });

  it("requires tier quantities of at least 2 and whole numbers", () => {
    expect(errorsOf(valid({ tiers: [{ minQuantity: 1, value: "5" }] }))).toHaveProperty("tiers.0.minQuantity");
    expect(errorsOf(valid({ tiers: [{ minQuantity: 2.5, value: "5" }] }))).toHaveProperty("tiers.0.minQuantity");
  });

  it("requires strictly ascending tier quantities", () => {
    const errors = errorsOf(
      valid({ tiers: [{ minQuantity: 3, value: "5" }, { minQuantity: 3, value: "10" }] }),
    );
    expect(errors["tiers.1.minQuantity"]).toMatch(/higher quantity/);
  });

  it("rejects a smaller discount at a higher quantity", () => {
    const errors = errorsOf(
      valid({ tiers: [{ minQuantity: 2, value: "10" }, { minQuantity: 3, value: "5" }] }),
    );
    expect(errors["tiers.1.value"]).toMatch(/smaller discount/);
  });

  it("bounds percentage values to (0, 100]", () => {
    expect(errorsOf(valid({ tiers: [{ minQuantity: 2, value: "0" }] }))).toHaveProperty("tiers.0.value");
    expect(errorsOf(valid({ tiers: [{ minQuantity: 2, value: "100.01" }] }))).toHaveProperty("tiers.0.value");
    expect(validateCampaignInput(valid({ tiers: [{ minQuantity: 2, value: "100" }] })).success).toBe(true);
  });

  it("allows fixed amounts above 100 but rejects absurd values", () => {
    expect(
      validateCampaignInput(valid({ discountType: "FIXED_AMOUNT", tiers: [{ minQuantity: 2, value: "250" }] })).success,
    ).toBe(true);
    expect(
      errorsOf(valid({ discountType: "FIXED_AMOUNT", tiers: [{ minQuantity: 2, value: "1000001" }] })),
    ).toHaveProperty("tiers.0.value");
  });

  it("rejects non-numeric and over-precise values", () => {
    expect(errorsOf(valid({ tiers: [{ minQuantity: 2, value: "abc" }] }))).toHaveProperty("tiers.0.value");
    expect(errorsOf(valid({ tiers: [{ minQuantity: 2, value: "1.234" }] }))).toHaveProperty("tiers.0.value");
    expect(errorsOf(valid({ tiers: [{ minQuantity: 2, value: "-5" }] }))).toHaveProperty("tiers.0.value");
  });

  it("requires the end date to be after the start date", () => {
    expect(
      errorsOf(valid({ startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" })),
    ).toHaveProperty("endsAt");
  });

  it("rejects non-object input", () => {
    expect(validateCampaignInput(null).success).toBe(false);
    expect(validateCampaignInput("x").success).toBe(false);
  });
});

describe("canTransition", () => {
  it("follows the campaign lifecycle", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "ARCHIVED")).toBe(true);
    expect(canTransition("ARCHIVED", "DRAFT")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransition("DRAFT", "PAUSED")).toBe(false);
    expect(canTransition("ARCHIVED", "ACTIVE")).toBe(false);
    expect(canTransition("ACTIVE", "DRAFT")).toBe(false);
  });
});

describe("findOverlappingProducts", () => {
  it("detects overlap when either side targets all variants", () => {
    expect(findOverlappingProducts([{ productGid: P1, variantGids: [] }], [{ productGid: P1, variantGids: [V1] }])).toEqual([P1]);
    expect(findOverlappingProducts([{ productGid: P1, variantGids: [V1] }], [{ productGid: P1, variantGids: [] }])).toEqual([P1]);
  });

  it("detects intersecting variant lists", () => {
    expect(
      findOverlappingProducts([{ productGid: P1, variantGids: [V1, V2] }], [{ productGid: P1, variantGids: [V2] }]),
    ).toEqual([P1]);
  });

  it("allows disjoint variants of the same product and different products", () => {
    expect(findOverlappingProducts([{ productGid: P1, variantGids: [V1] }], [{ productGid: P1, variantGids: [V2] }])).toEqual([]);
    expect(findOverlappingProducts([{ productGid: P1, variantGids: [] }], [{ productGid: P2, variantGids: [] }])).toEqual([]);
  });
});

describe("subscription options", () => {
  it("defaults to both purchase types and the first subscription order (Shopify's defaults)", () => {
    const result = validateCampaignInput(valid());
    expect(result.success && result.data).toMatchObject({ purchaseType: "BOTH", recurringCycleLimit: 1 });
  });

  it("accepts each purchase type and order limit, including every order (0)", () => {
    for (const purchaseType of ["ONE_TIME", "SUBSCRIPTION", "BOTH"]) {
      expect(validateCampaignInput(valid({ purchaseType })).success).toBe(true);
    }
    const result = validateCampaignInput(valid({ purchaseType: "SUBSCRIPTION", recurringCycleLimit: "0" }));
    expect(result.success && result.data.recurringCycleLimit).toBe(0);
  });

  it("rejects unknown purchase types and out-of-range order limits", () => {
    expect(errorsOf(valid({ purchaseType: "WEEKLY" })).purchaseType).toBeTruthy();
    expect(errorsOf(valid({ recurringCycleLimit: -1 })).recurringCycleLimit).toBeTruthy();
    expect(errorsOf(valid({ recurringCycleLimit: 101 })).recurringCycleLimit).toBeTruthy();
    expect(errorsOf(valid({ recurringCycleLimit: 2.5 })).recurringCycleLimit).toBeTruthy();
  });
});

describe("quantity 1 tiers", () => {
  it("are allowed only for subscription-only campaigns", () => {
    const tiers = [{ minQuantity: 1, value: "10" }];
    expect(validateCampaignInput(valid({ purchaseType: "SUBSCRIPTION", tiers })).success).toBe(true);
    expect(errorsOf(valid({ purchaseType: "BOTH", tiers }))["tiers.0.minQuantity"]).toMatch(/subscriptions only/);
    expect(errorsOf(valid({ purchaseType: "ONE_TIME", tiers }))["tiers.0.minQuantity"]).toMatch(/at least 2/);
    expect(errorsOf(valid({ purchaseType: "SUBSCRIPTION", tiers: [{ minQuantity: 0, value: "10" }] }))["tiers.0.minQuantity"]).toBeTruthy();
  });
});
