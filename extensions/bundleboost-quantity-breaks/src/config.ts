/**
 * Configuration written by the BundleBoost app into the discount's
 * `$app:function-configuration` metafield. Kept compact because Shopify does
 * not return metafield values larger than 10,000 bytes to Functions.
 *
 * Contract shared with app/lib/discount-config.ts (covered by a test).
 */
export type QuantityBreakConfig = {
  /** Schema version. */
  v: 1;
  /** "P" = percentage off each item, "F" = fixed amount off each item. */
  t: "P" | "F";
  /** Buyer-facing discount message. */
  m: string;
  /** Numeric product id → eligible numeric variant ids ([] = all variants). */
  p: Record<string, string[]>;
  /** [minimum quantity, value] sorted by ascending quantity. */
  tiers: [number, string][];
};

export function parseConfig(raw: unknown): QuantityBreakConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<QuantityBreakConfig>;
  if (c.v !== 1 || (c.t !== "P" && c.t !== "F")) return null;
  if (!c.p || typeof c.p !== "object" || !Array.isArray(c.tiers)) return null;
  const tiers = c.tiers.filter(
    (t): t is [number, string] =>
      Array.isArray(t) &&
      Number.isInteger(t[0]) &&
      t[0] > 0 &&
      Number(t[1]) > 0,
  );
  if (!tiers.length) return null;
  tiers.sort((a, b) => a[0] - b[0]);
  return { v: 1, t: c.t, m: typeof c.m === "string" ? c.m : "", p: c.p, tiers };
}

/** "gid://shopify/Product/123" → "123" */
export function numericId(gid: string): string {
  return gid.slice(gid.lastIndexOf("/") + 1);
}
