import { adminQuery, type AdminGraphqlClient } from "./graphql";
import { BUNDLEBOOST_APP_ID } from "./subscription-plans";

/**
 * BundleBoost's own subscription plans (selling plans), so merchants can
 * rename or hide frequencies in the widget. Plans from other apps are
 * ignored (App Store requirement 5.4.2). Requires read_products.
 */

const SELLING_PLANS_QUERY = `#graphql
  query BundleBoostSellingPlans($first: Int!) {
    sellingPlanGroups(first: $first) {
      nodes {
        id
        name
        appId
        sellingPlans(first: 20) {
          nodes {
            id
            name
            pricingPolicies {
              __typename
              ... on SellingPlanFixedPricingPolicy {
                adjustmentType
                adjustmentValue {
                  __typename
                  ... on SellingPlanPricingPolicyPercentageValue {
                    percentage
                  }
                  ... on MoneyV2 {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

type PricingPolicy = {
  __typename: string;
  adjustmentType?: string;
  adjustmentValue?: { __typename: string; percentage?: number; amount?: string; currencyCode?: string };
};

type QueryResult = {
  sellingPlanGroups: {
    nodes: {
      id: string;
      name: string;
      appId: string | null;
      sellingPlans: { nodes: { id: string; name: string; pricingPolicies: PricingPolicy[] }[] };
    }[];
  };
};

export type ShopSellingPlan = {
  /** Numeric id, as the storefront (Liquid) sees it. */
  id: string;
  name: string;
  groupName: string;
  /** Saving shown in "Subscribe & save {discount}", e.g. "10%"; empty if none. */
  discount: string;
  /** Percentage off, when the plan has one (for the preview price). */
  percent: number | null;
};

const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

function describeDiscount(policies: PricingPolicy[]): { discount: string; percent: number | null } {
  const fixed = policies.find((p) => p.__typename === "SellingPlanFixedPricingPolicy");
  const value = fixed?.adjustmentValue;
  if (value?.__typename === "SellingPlanPricingPolicyPercentageValue" && typeof value.percentage === "number") {
    return { discount: `${Number(value.percentage.toFixed(2))}%`, percent: value.percentage };
  }
  if (value?.__typename === "MoneyV2" && value.amount && fixed?.adjustmentType === "FIXED_AMOUNT") {
    try {
      const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: value.currencyCode ?? "USD" }).format(
        Number(value.amount),
      );
      return { discount: amount, percent: null };
    } catch {
      return { discount: "", percent: null };
    }
  }
  return { discount: "", percent: null };
}

export async function fetchSellingPlans(admin: AdminGraphqlClient): Promise<ShopSellingPlan[]> {
  const data = await adminQuery<QueryResult>(admin, SELLING_PLANS_QUERY, { first: 25 });
  return data.sellingPlanGroups.nodes.filter((group) => group.appId === BUNDLEBOOST_APP_ID).flatMap((group) =>
    group.sellingPlans.nodes.map((plan) => ({
      id: numericId(plan.id),
      name: plan.name,
      groupName: group.name,
      ...describeDiscount(plan.pricingPolicies),
    })),
  );
}
