import { ShopifyApiError } from "../errors";
import { adminQuery, type AdminGraphqlClient } from "./graphql";

/**
 * Admin API operations for the subscription plans BundleBoost creates
 * (Shopify selling plan groups). Requires write_products and
 * write_purchase_options. Validated against Admin API 2026-07.
 *
 * Renewals for subscriptions bought on these plans are BundleBoost's job
 * (billing attempts), which needs Shopify's protected Subscription API access.
 */

type UserError = { field?: string[] | null; message: string; code?: string | null };

/**
 * Tags every selling plan group BundleBoost creates (exposed in Liquid as
 * selling_plan_group.app_id), so the app and its storefront block only ever
 * use BundleBoost's own plans, never another app's.
 */
export const BUNDLEBOOST_APP_ID = "bundleboost";

export class SellingPlanUserError extends ShopifyApiError {
  constructor(public readonly userErrors: UserError[]) {
    super(userErrors.map((e) => e.message).join("; "));
  }
}

function assertNoUserErrors(errors: UserError[] | undefined) {
  if (errors?.length) throw new SellingPlanUserError(errors);
}

export type FrequencyInterval = "DAY" | "WEEK" | "MONTH" | "YEAR";

export type SellingPlanSpec = {
  /** Existing Shopify selling plan, when updating. */
  shopifyId?: string | null;
  name: string;
  /** Unique within the group, e.g. "3 month(s)". */
  option: string;
  interval: FrequencyInterval;
  intervalCount: number;
  /** Percentage off each subscription order; 0 = no discount. */
  discountPercent: number;
  position: number;
};

export type SellingPlanGroupSpec = {
  name: string;
  merchantCode: string;
  /** The label above the frequency options, e.g. "Delivery every". */
  optionName: string;
  plans: SellingPlanSpec[];
};

const GROUP_FIELDS = `
  id
  sellingPlans(first: 50) {
    nodes {
      id
      options
    }
  }`;

const CREATE = `#graphql
  mutation BundleBoostSellingPlanGroupCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      sellingPlanGroup {${GROUP_FIELDS}
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const UPDATE = `#graphql
  mutation BundleBoostSellingPlanGroupUpdate($id: ID!, $input: SellingPlanGroupInput!) {
    sellingPlanGroupUpdate(id: $id, input: $input) {
      sellingPlanGroup {${GROUP_FIELDS}
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const ADD_PRODUCTS = `#graphql
  mutation BundleBoostSellingPlanGroupAddProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
      sellingPlanGroup {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const REMOVE_PRODUCTS = `#graphql
  mutation BundleBoostSellingPlanGroupRemoveProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
      removedProductIds
      userErrors {
        field
        message
        code
      }
    }
  }`;

const GROUP_STATE = `#graphql
  query BundleBoostSellingPlanGroupState($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      products(first: 250) {
        nodes {
          id
        }
      }
      sellingPlans(first: 50) {
        nodes {
          id
          options
        }
      }
    }
  }`;

/** What the group holds in Shopify now: its products and plans (by option). Null if it's gone. */
export async function fetchSellingPlanGroupState(admin: AdminGraphqlClient, id: string) {
  const data = await adminQuery<{
    sellingPlanGroup: {
      products: { nodes: { id: string }[] };
      sellingPlans: { nodes: { id: string; options: string[] }[] };
    } | null;
  }>(admin, GROUP_STATE, { id });
  const group = data.sellingPlanGroup;
  if (!group) return null;
  return {
    productIds: group.products.nodes.map((p) => p.id),
    plans: group.sellingPlans.nodes.map((p) => ({ id: p.id, option: p.options[0] })),
  };
}

const DELETE = `#graphql
  mutation BundleBoostSellingPlanGroupDelete($id: ID!) {
    sellingPlanGroupDelete(id: $id) {
      deletedSellingPlanGroupId
      userErrors {
        field
        message
        code
      }
    }
  }`;

type GroupPayload = {
  sellingPlanGroup: { id: string; sellingPlans: { nodes: { id: string; options: string[] }[] } } | null;
  userErrors: UserError[];
};

function planInput(plan: SellingPlanSpec) {
  const recurring = { interval: plan.interval, intervalCount: plan.intervalCount };
  return {
    ...(plan.shopifyId ? { id: plan.shopifyId } : {}),
    name: plan.name,
    options: [plan.option],
    position: plan.position,
    category: "SUBSCRIPTION",
    // Pay per delivery: billed and delivered on the same schedule, starting
    // from the purchase date (no anchors).
    billingPolicy: { recurring },
    deliveryPolicy: { recurring: { ...recurring, intent: "FULFILLMENT_BEGIN" } },
    pricingPolicies:
      plan.discountPercent > 0
        ? [{ fixed: { adjustmentType: "PERCENTAGE", adjustmentValue: { percentage: plan.discountPercent } } }]
        : [],
  };
}

/** Maps each plan's option (unique in the group) to its Shopify selling plan id. */
function idsByOption(group: NonNullable<GroupPayload["sellingPlanGroup"]>) {
  return Object.fromEntries(group.sellingPlans.nodes.map((p) => [p.options[0], p.id]));
}

export async function createSellingPlanGroup(
  admin: AdminGraphqlClient,
  spec: SellingPlanGroupSpec,
  productIds: string[],
) {
  const data = await adminQuery<{ sellingPlanGroupCreate: GroupPayload }>(admin, CREATE, {
    input: {
      name: spec.name,
      merchantCode: spec.merchantCode,
      appId: BUNDLEBOOST_APP_ID,
      options: [spec.optionName],
      position: 1,
      sellingPlansToCreate: spec.plans.map(planInput),
    },
    resources: { productIds },
  });
  const payload = data.sellingPlanGroupCreate;
  assertNoUserErrors(payload.userErrors);
  if (!payload.sellingPlanGroup) throw new ShopifyApiError("Shopify did not return the subscription plan.");
  return { id: payload.sellingPlanGroup.id, planIds: idsByOption(payload.sellingPlanGroup) };
}

/** Updates the group and its plans: existing ones by id, new ones created, removed ones deleted. */
export async function updateSellingPlanGroup(
  admin: AdminGraphqlClient,
  id: string,
  spec: SellingPlanGroupSpec,
  deletePlanIds: string[],
) {
  const data = await adminQuery<{ sellingPlanGroupUpdate: GroupPayload }>(admin, UPDATE, {
    id,
    input: {
      name: spec.name,
      merchantCode: spec.merchantCode,
      appId: BUNDLEBOOST_APP_ID,
      options: [spec.optionName],
      sellingPlansToCreate: spec.plans.filter((p) => !p.shopifyId).map(planInput),
      sellingPlansToUpdate: spec.plans.filter((p) => p.shopifyId).map(planInput),
      sellingPlansToDelete: deletePlanIds,
    },
  });
  const payload = data.sellingPlanGroupUpdate;
  assertNoUserErrors(payload.userErrors);
  if (!payload.sellingPlanGroup) throw new ShopifyApiError("Shopify did not return the subscription plan.");
  return { id: payload.sellingPlanGroup.id, planIds: idsByOption(payload.sellingPlanGroup) };
}

export async function addSellingPlanGroupProducts(admin: AdminGraphqlClient, id: string, productIds: string[]) {
  if (!productIds.length) return;
  const data = await adminQuery<{ sellingPlanGroupAddProducts: { userErrors: UserError[] } }>(admin, ADD_PRODUCTS, {
    id,
    productIds,
  });
  assertNoUserErrors(data.sellingPlanGroupAddProducts.userErrors);
}

export async function removeSellingPlanGroupProducts(admin: AdminGraphqlClient, id: string, productIds: string[]) {
  if (!productIds.length) return;
  const data = await adminQuery<{ sellingPlanGroupRemoveProducts: { userErrors: UserError[] } }>(
    admin,
    REMOVE_PRODUCTS,
    { id, productIds },
  );
  assertNoUserErrors(data.sellingPlanGroupRemoveProducts.userErrors);
}

export async function deleteSellingPlanGroup(admin: AdminGraphqlClient, id: string) {
  const data = await adminQuery<{ sellingPlanGroupDelete: { userErrors: UserError[] } }>(admin, DELETE, { id });
  assertNoUserErrors(data.sellingPlanGroupDelete.userErrors);
}
