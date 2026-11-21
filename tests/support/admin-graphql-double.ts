import type { AdminGraphqlClient } from "../../app/.server/shopify/graphql";

/**
 * Test double for the Admin GraphQL client, standing in for a store's
 * catalogue. Only used by the test suite — production code always talks to
 * Shopify through the authenticated library client.
 */
export type FakeProduct = {
  id: string;
  title: string;
  variants: { id: string; title: string }[];
};

export function productGid(n: number) {
  return `gid://shopify/Product/${n}`;
}
export function variantGid(n: number) {
  return `gid://shopify/ProductVariant/${n}`;
}

export function fakeProduct(n: number, variantCount = 2): FakeProduct {
  return {
    id: productGid(n),
    title: `Product ${n}`,
    variants: Array.from({ length: variantCount }, (_, i) => ({
      id: variantGid(n * 100 + i + 1),
      title: `Variant ${i + 1}`,
    })),
  };
}

export type FakeDiscount = {
  id: string;
  title: string;
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED";
  startsAt: string;
  endsAt: string | null;
  combinesWith: Record<string, boolean>;
  functionHandle: string;
  discountClasses: string[];
  config: string;
};

/**
 * Stateful stand-in for the store: catalogue lookups plus automatic app
 * discounts and app metafields, so sync logic can be exercised end to end.
 * `failNext` makes the next matching operation return a userError.
 */
export function createAdminDouble(catalog: FakeProduct[]) {
  const calls: { query: string; variables?: Record<string, unknown> }[] = [];
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const discounts = new Map<string, FakeDiscount>();
  const appMetafields = new Map<string, string>();
  const failures: { operation: string; message: string }[] = [];
  let nextDiscount = 1000;
  let activeSubs: { id: string; name: string; status: string; test: boolean; trialDays: number; currentPeriodEnd: string | null }[] = [];

  const userError = (message: string, field = ["base"]) => ({ field, message, code: null });
  const takeFailure = (operation: string) => {
    const i = failures.findIndex((f) => f.operation === operation);
    return i === -1 ? null : failures.splice(i, 1)[0];
  };

  const client: AdminGraphqlClient = {
    async graphql(query, options) {
      calls.push({ query, variables: options?.variables });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (options?.variables ?? {}) as Record<string, any>;
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      const failure = takeFailure(op);
      if (failure?.message === "NETWORK") throw new Error("socket hang up");

      if (op === "BundleBoostDiscountCreate") {
        if (failure) return Response.json({ data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [userError(failure.message)] } } });
        const id = `gid://shopify/DiscountAutomaticNode/${nextDiscount++}`;
        const d = v.discount;
        discounts.set(id, {
          id,
          title: d.title,
          status: "ACTIVE",
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          combinesWith: d.combinesWith,
          functionHandle: d.functionHandle,
          discountClasses: d.discountClasses,
          config: d.metafields?.[0]?.value,
        });
        return Response.json({ data: { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: id, status: "ACTIVE" }, userErrors: [] } } });
      }
      if (op === "BundleBoostDiscountUpdate") {
        const existing = discounts.get(v.id);
        if (!existing || failure) {
          return Response.json({ data: { discountAutomaticAppUpdate: { automaticAppDiscount: null, userErrors: [existing ? userError(failure!.message) : userError("Discount does not exist", ["id"])] } } });
        }
        Object.assign(existing, {
          title: v.discount.title,
          startsAt: v.discount.startsAt,
          endsAt: v.discount.endsAt,
          combinesWith: v.discount.combinesWith,
        });
        return Response.json({ data: { discountAutomaticAppUpdate: { automaticAppDiscount: { discountId: existing.id, status: existing.status }, userErrors: [] } } });
      }
      if (op === "BundleBoostDiscountActivate" || op === "BundleBoostDiscountDeactivate") {
        const key = op === "BundleBoostDiscountActivate" ? "discountAutomaticActivate" : "discountAutomaticDeactivate";
        const existing = discounts.get(v.id);
        if (!existing) return Response.json({ data: { [key]: { automaticDiscountNode: null, userErrors: [userError("Discount does not exist", ["id"])] } } });
        existing.status = op === "BundleBoostDiscountActivate" ? "ACTIVE" : "EXPIRED";
        return Response.json({ data: { [key]: { automaticDiscountNode: { id: existing.id }, userErrors: [] } } });
      }
      if (op === "BundleBoostDiscountDelete") {
        if (!discounts.delete(v.id)) {
          return Response.json({ data: { discountAutomaticDelete: { deletedAutomaticDiscountId: null, userErrors: [userError("Discount does not exist", ["id"])] } } });
        }
        return Response.json({ data: { discountAutomaticDelete: { deletedAutomaticDiscountId: v.id, userErrors: [] } } });
      }
      if (op === "BundleBoostMetafieldsSet") {
        if (failure) return Response.json({ data: { metafieldsSet: { metafields: [], userErrors: [userError(failure.message)] } } });
        for (const m of v.metafields as { ownerId: string; namespace: string; key: string; value: string }[]) {
          const discount = discounts.get(m.ownerId);
          if (discount) discount.config = m.value;
          else appMetafields.set(`${m.namespace}.${m.key}`, m.value);
        }
        return Response.json({ data: { metafieldsSet: { metafields: [], userErrors: [] } } });
      }
      if (op === "BundleBoostAppInstallationId") {
        return Response.json({ data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
      }
      if (op === "BundleBoostActiveSubscriptions") {
        if (failure) return Response.json({ errors: [{ message: failure.message }] }, { status: 500 });
        return Response.json({ data: { currentAppInstallation: { activeSubscriptions: activeSubs } } });
      }
      if (op === "BundleBoostSubscriptionCancel") {
        if (failure) return Response.json({ errors: [{ message: failure.message }] }, { status: 500 });
        return Response.json({
          data: {
            appSubscriptionCancel: {
              appSubscription: { id: v.id, status: "CANCELLED" },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("BundleBoostProductsById")) {
        const ids = (options?.variables?.ids ?? []) as string[];
        const nodes = ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return {
            id: p.id,
            title: p.title,
            handle: p.title.toLowerCase().replace(/\s+/g, "-"),
            featuredMedia: null,
            variants: { nodes: p.variants },
          };
        });
        return Response.json({ data: { nodes } });
      }
      if (query.includes("BundleBoostShopInfo")) {
        return Response.json({ data: { shop: { name: "Test Shop", currencyCode: "EUR" } } });
      }
      return Response.json({ errors: [{ message: "Unhandled query in test double" }] });
    },
  };
  return {
    client,
    calls,
    discounts,
    appMetafields,
    setActiveSubscriptions(subs: typeof activeSubs) {
      activeSubs = subs;
    },
    failNext(operation: string, message: string) {
      failures.push({ operation, message });
    },
  };
}
