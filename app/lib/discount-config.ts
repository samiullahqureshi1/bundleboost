/**
 * Builds the compact configuration stored in each Shopify automatic discount's
 * `$app:function-configuration` metafield and read by the Discount Function
 * (extensions/bundleboost-quantity-breaks/src/config.ts).
 */

export const FUNCTION_CONFIG_MAX_BYTES = 9_000; // Shopify stops returning values > 10,000 bytes.

export type DiscountConfigSource = {
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  message: string;
  products: { productGid: string; variantGids: string[] }[];
  tiers: { minQuantity: number; value: string }[];
  purchaseType?: "ONE_TIME" | "SUBSCRIPTION" | "BOTH";
};

const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

export function buildFunctionConfig(source: DiscountConfigSource) {
  // Omitted for "both" so existing discounts keep the same configuration.
  const purchase: { s?: "S" | "O" } =
    source.purchaseType === "SUBSCRIPTION" ? { s: "S" } : source.purchaseType === "ONE_TIME" ? { s: "O" } : {};
  return {
    v: 1 as const,
    t: source.discountType === "PERCENTAGE" ? ("P" as const) : ("F" as const),
    m: source.message,
    p: Object.fromEntries(
      source.products.map((p) => [numericId(p.productGid), p.variantGids.map(numericId)]),
    ),
    tiers: [...source.tiers]
      .sort((a, b) => a.minQuantity - b.minQuantity)
      .map((t) => [t.minQuantity, Number(t.value).toFixed(2)] as [number, string]),
    ...purchase,
  };
}

export function serializeFunctionConfig(source: DiscountConfigSource) {
  const json = JSON.stringify(buildFunctionConfig(source));
  return { json, bytes: new TextEncoder().encode(json).length };
}
