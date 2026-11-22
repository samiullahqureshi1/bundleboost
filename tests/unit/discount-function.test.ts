import { describe, expect, it } from "vitest";
import {
  cartLinesDiscountsGenerateRun,
  type CartLinesDiscountsGenerateRunInput,
} from "../../extensions/bundleboost-quantity-breaks/src/cart_lines_discounts_generate_run";
import { parseConfig } from "../../extensions/bundleboost-quantity-breaks/src/config";
import {
  buildFunctionConfig,
  serializeFunctionConfig,
  FUNCTION_CONFIG_MAX_BYTES,
} from "../../app/lib/discount-config";

const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;

function line(id: number, product: number, variant: number, quantity: number) {
  return {
    id: `gid://shopify/CartLine/${id}`,
    quantity,
    merchandise: { __typename: "ProductVariant" as const, id: V(variant), product: { id: P(product) } },
  };
}

function input(
  lines: CartLinesDiscountsGenerateRunInput["cart"]["lines"],
  config: unknown,
  overrides: Partial<CartLinesDiscountsGenerateRunInput> = {},
): CartLinesDiscountsGenerateRunInput {
  return {
    presentmentCurrencyRate: "1.0",
    cart: { lines },
    discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: config } },
    ...overrides,
  };
}

// Built through the app's builder, so these tests also pin the contract
// between the app (writer) and the Function (reader).
const percentConfig = buildFunctionConfig({
  discountType: "PERCENTAGE",
  message: "Bulk savings",
  products: [
    { productGid: P(1), variantGids: [] },
    { productGid: P(2), variantGids: [V(21)] },
  ],
  tiers: [
    { minQuantity: 4, value: "15" },
    { minQuantity: 2, value: "5" },
  ],
});

describe("cartLinesDiscountsGenerateRun", () => {
  it("applies nothing below the first tier", () => {
    expect(cartLinesDiscountsGenerateRun(input([line(1, 1, 11, 1)], percentConfig))).toEqual({ operations: [] });
  });

  it("applies the highest tier reached, summing variants of the same product", () => {
    const result = cartLinesDiscountsGenerateRun(
      input([line(1, 1, 11, 2), line(2, 1, 12, 2), line(3, 9, 91, 10)], percentConfig),
    );
    expect(result.operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Bulk savings",
              targets: [
                { cartLine: { id: "gid://shopify/CartLine/1" } },
                { cartLine: { id: "gid://shopify/CartLine/2" } },
              ],
              value: { percentage: { value: "15" } },
            },
          ],
          selectionStrategy: "ALL",
        },
      },
    ]);
  });

  it("uses exact tier boundaries", () => {
    const result = cartLinesDiscountsGenerateRun(input([line(1, 1, 11, 2)], percentConfig));
    expect(result.operations[0].productDiscountsAdd.candidates[0].value).toEqual({ percentage: { value: "5" } });
  });

  it("only counts and discounts eligible variants", () => {
    const result = cartLinesDiscountsGenerateRun(
      input([line(1, 2, 21, 1), line(2, 2, 22, 5)], percentConfig),
    );
    expect(result.operations).toEqual([]);
    const eligible = cartLinesDiscountsGenerateRun(input([line(1, 2, 21, 3), line(2, 2, 22, 5)], percentConfig));
    expect(eligible.operations[0].productDiscountsAdd.candidates[0].targets).toEqual([
      { cartLine: { id: "gid://shopify/CartLine/1" } },
    ]);
  });

  it("evaluates each product independently", () => {
    const result = cartLinesDiscountsGenerateRun(
      input([line(1, 1, 11, 1), line(2, 2, 21, 2)], percentConfig),
    );
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].productDiscountsAdd.candidates[0].targets[0].cartLine.id).toBe("gid://shopify/CartLine/2");
  });

  it("emits one operation with one candidate per tier reached, across products", () => {
    const result = cartLinesDiscountsGenerateRun(
      input(
        [line(1, 1, 11, 4), line(2, 2, 21, 2), line(3, 1, 12, 1), line(4, 2, 21, 0)],
        percentConfig,
      ),
    );
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0].productDiscountsAdd;
    expect(op.selectionStrategy).toBe("ALL");
    expect(op.candidates.map((c) => [c.value, c.targets.map((t) => t.cartLine.id)])).toEqual([
      [{ percentage: { value: "5" } }, ["gid://shopify/CartLine/2", "gid://shopify/CartLine/4"]],
      [{ percentage: { value: "15" } }, ["gid://shopify/CartLine/1", "gid://shopify/CartLine/3"]],
    ]);
  });

  it("converts fixed amounts to the presentment currency, per item", () => {
    const config = buildFunctionConfig({
      discountType: "FIXED_AMOUNT",
      message: "",
      products: [{ productGid: P(1), variantGids: [] }],
      tiers: [{ minQuantity: 3, value: "2.50" }],
    });
    const result = cartLinesDiscountsGenerateRun(
      input([line(1, 1, 11, 3)], config, { presentmentCurrencyRate: "1.5" }),
    );
    const candidate = result.operations[0].productDiscountsAdd.candidates[0];
    expect(candidate.value).toEqual({ fixedAmount: { amount: "3.75", appliesToEachItem: true } });
    expect(candidate).not.toHaveProperty("message");
  });

  it("does nothing without the PRODUCT discount class, config, or valid config", () => {
    const lines = [line(1, 1, 11, 5)];
    expect(cartLinesDiscountsGenerateRun(input(lines, percentConfig, { discount: { discountClasses: ["ORDER"], metafield: { jsonValue: percentConfig } } })).operations).toEqual([]);
    expect(cartLinesDiscountsGenerateRun(input(lines, null)).operations).toEqual([]);
    expect(cartLinesDiscountsGenerateRun(input(lines, { v: 2 })).operations).toEqual([]);
  });

  it("ignores custom products", () => {
    const custom = { id: "gid://shopify/CartLine/9", quantity: 10, merchandise: { __typename: "CustomProduct" as const } };
    expect(cartLinesDiscountsGenerateRun(input([custom], percentConfig)).operations).toEqual([]);
  });

  it("never emits more than 100% off", () => {
    const config = { ...percentConfig, tiers: [[2, "150.00"]] };
    const result = cartLinesDiscountsGenerateRun(input([line(1, 1, 11, 2)], config));
    expect(result.operations[0].productDiscountsAdd.candidates[0].value).toEqual({ percentage: { value: "100" } });
  });
});

describe("function configuration contract", () => {
  it("round-trips through the Function's parser with sorted tiers and numeric ids", () => {
    const parsed = parseConfig(JSON.parse(JSON.stringify(percentConfig)));
    expect(parsed).toEqual({
      v: 1,
      t: "P",
      m: "Bulk savings",
      p: { "1": [], "2": ["21"] },
      tiers: [
        [2, "5.00"],
        [4, "15.00"],
      ],
    });
  });

  it("reports serialized size so oversized campaigns can be rejected", () => {
    const products = Array.from({ length: 100 }, (_, i) => ({
      productGid: P(9000000000000 + i),
      variantGids: Array.from({ length: 20 }, (_, j) => V(40000000000000 + i * 100 + j)),
    }));
    const { bytes } = serializeFunctionConfig({ discountType: "PERCENTAGE", message: "x", products, tiers: [{ minQuantity: 2, value: "5" }] });
    expect(bytes).toBeGreaterThan(FUNCTION_CONFIG_MAX_BYTES);
  });
});

describe("subscription-only and one-time-only campaigns", () => {
  const subscriptionLine = (id: number, product: number, variant: number, quantity: number) => ({
    ...line(id, product, variant, quantity),
    sellingPlanAllocation: { __typename: "SellingPlanAllocation" },
  });
  const source = {
    discountType: "PERCENTAGE" as const,
    message: "Subscriber perk",
    products: [{ productGid: P(1), variantGids: [] }],
    tiers: [{ minQuantity: 1, value: "10" }],
  };

  it("writes the purchase type into the config only when it narrows the campaign", () => {
    expect(buildFunctionConfig({ ...source, purchaseType: "SUBSCRIPTION" }).s).toBe("S");
    expect(buildFunctionConfig({ ...source, purchaseType: "ONE_TIME" }).s).toBe("O");
    expect("s" in buildFunctionConfig({ ...source, purchaseType: "BOTH" })).toBe(false);
    expect(parseConfig({ ...buildFunctionConfig(source), s: "X" })?.s).toBeUndefined();
  });

  it("gives a 1-item subscription its discount and skips one-time lines", () => {
    const config = buildFunctionConfig({ ...source, purchaseType: "SUBSCRIPTION" });
    const result = cartLinesDiscountsGenerateRun(
      input([line(1, 1, 11, 1), subscriptionLine(2, 1, 12, 1)], config),
    );
    expect(result.operations).toHaveLength(1);
    const [candidate] = result.operations[0].productDiscountsAdd.candidates;
    expect(candidate.targets).toEqual([{ cartLine: { id: "gid://shopify/CartLine/2" } }]);
    expect(candidate.value).toEqual({ percentage: { value: "10" } });
  });

  it("counts only matching lines toward a tier", () => {
    const config = buildFunctionConfig({ ...source, purchaseType: "SUBSCRIPTION", tiers: [{ minQuantity: 3, value: "10" }] });
    // 2 one-time + 2 subscription: only 2 subscription items count, below the tier.
    expect(
      cartLinesDiscountsGenerateRun(input([line(1, 1, 11, 2), subscriptionLine(2, 1, 12, 2)], config)).operations,
    ).toEqual([]);
  });

  it("one-time-only campaigns ignore subscription lines", () => {
    const config = buildFunctionConfig({ ...source, purchaseType: "ONE_TIME", tiers: [{ minQuantity: 2, value: "5" }] });
    const result = cartLinesDiscountsGenerateRun(
      input([line(1, 1, 11, 2), subscriptionLine(2, 1, 12, 5)], config),
    );
    expect(result.operations[0].productDiscountsAdd.candidates[0].targets).toEqual([
      { cartLine: { id: "gid://shopify/CartLine/1" } },
    ]);
  });
});
