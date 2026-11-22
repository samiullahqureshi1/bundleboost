import type { ApiVersion } from "@shopify/shopify-app-react-router/server";
import { ShopifyApiError } from "../errors";
import { adminQuery, type AdminGraphqlClient } from "./graphql";

/**
 * Admin API operations behind the customer subscription portal (the
 * "My subscriptions" page in Shopify customer accounts). Every call is made
 * for the signed-in customer only; the service checks ownership first.
 *
 * The delivery address is protected customer data the app isn't approved
 * for, so it isn't read here: the extension reads it with the Customer
 * Account API (the customer's own data).
 *
 * Reads are validated against Admin API 2026-07. Changing the frequency uses
 * the contract Calculation API, which needs 2026-10 (requested per call).
 */

type UserError = { field?: string[] | null; message: string; code?: string | null };

export class PortalUserError extends ShopifyApiError {
  constructor(public readonly userErrors: UserError[]) {
    super(userErrors.map((e) => e.message).join("; "));
  }
}

function assertNoUserErrors(errors: UserError[] | undefined) {
  if (errors?.length) throw new PortalUserError(errors);
}

/** API version with the subscription contract Calculation API. */
// Newer than the app default (and the library's ApiVersion enum), so cast.
export const CALCULATION_API_VERSION = "2026-10" as ApiVersion;

const PORTAL_CONTRACT_FIELDS = `
  id
  status
  createdAt
  nextBillingDate
  currencyCode
  customer {
    id
  }
  billingPolicy {
    interval
    intervalCount
  }
  deliveryPrice {
    amount
  }
  lines(first: 20) {
    nodes {
      id
      title
      variantTitle
      quantity
      sellingPlanId
      sellingPlanName
      currentPrice {
        amount
      }
      variantImage {
        url
        altText
      }
    }
  }
  customerPaymentMethod {
    id
    instrument {
      __typename
      ... on CustomerCreditCard {
        brand
        lastDigits
        expiryMonth
        expiryYear
      }
      ... on CustomerShopPayAgreement {
        lastDigits
        expiryMonth
        expiryYear
      }
      ... on CustomerPaypalBillingAgreement {
        paypalAccountEmail
      }
    }
  }
  orders(first: 12, reverse: true) {
    nodes {
      id
      name
      createdAt
      displayFulfillmentStatus
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
  }`;

const CUSTOMER_CONTRACTS = `#graphql
  query BundleBoostPortalContracts($customerId: ID!) {
    customer(id: $customerId) {
      subscriptionContracts(first: 25, reverse: true) {
        nodes {${PORTAL_CONTRACT_FIELDS}
        }
      }
    }
  }`;

const CONTRACT = `#graphql
  query BundleBoostPortalContract($id: ID!) {
    subscriptionContract(id: $id) {${PORTAL_CONTRACT_FIELDS}
    }
  }`;


export type PortalShopifyContract = {
  id: string;
  status: string;
  createdAt: string;
  nextBillingDate: string | null;
  currencyCode: string;
  customer: { id: string } | null;
  billingPolicy: { interval: string; intervalCount: number };
  deliveryPrice: { amount: string } | null;
  lines: {
    nodes: {
      id: string;
      title: string;
      variantTitle: string | null;
      quantity: number;
      sellingPlanId: string | null;
      sellingPlanName: string | null;
      currentPrice: { amount: string };
      variantImage: { url: string; altText: string | null } | null;
    }[];
  };
  customerPaymentMethod: {
    id: string;
    instrument: {
      __typename: string;
      brand?: string;
      lastDigits?: string;
      expiryMonth?: number;
      expiryYear?: number;
      paypalAccountEmail?: string | null;
    } | null;
  } | null;
  orders: {
    nodes: {
      id: string;
      name: string;
      createdAt: string;
      displayFulfillmentStatus: string;
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    }[];
  };
};

/** The customer's subscriptions owned by this app (read_own_subscription_contracts). */
export async function fetchCustomerContracts(admin: AdminGraphqlClient, customerId: string) {
  const data = await adminQuery<{
    customer: { subscriptionContracts: { nodes: PortalShopifyContract[] } } | null;
  }>(admin, CUSTOMER_CONTRACTS, { customerId });
  return data.customer?.subscriptionContracts.nodes ?? [];
}

export async function fetchPortalContract(admin: AdminGraphqlClient, id: string) {
  const data = await adminQuery<{ subscriptionContract: PortalShopifyContract | null }>(admin, CONTRACT, { id });
  return data.subscriptionContract;
}

// ---------------------------------------------------------------------------
// Frequency change (Calculation API, 2026-10)
// ---------------------------------------------------------------------------

const CONTRACT_LINES = `#graphql
  query BundleBoostPortalContractLines($id: ID!) {
    subscriptionContract(id: $id) {
      id
      currencyCode
      lines(first: 50) {
        nodes {
          id
          quantity
          variantId
          sellingPlanId
          customAttributes {
            key
            value
          }
          currentPrice {
            amount
          }
          pricingPolicy {
            basePrice {
              amount
            }
          }
        }
      }
    }
  }`;

const UPDATE_CALCULATE = `#graphql
  mutation BundleBoostPortalUpdateCalculate($contractId: ID!, $input: SubscriptionContractCalculationContractUpdateInput!) {
    subscriptionContractUpdateCalculate(contractId: $contractId, contractUpdateInput: $input) {
      subscriptionContractCalculation {
        ... on SubscriptionContractCalculationPending {
          id
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const CALCULATION = `#graphql
  query BundleBoostPortalCalculation($id: ID!) {
    subscriptionContractCalculation(id: $id) {
      __typename
      ... on SubscriptionContractCalculationPending {
        id
      }
      ... on SubscriptionContractCalculationSuccess {
        id
      }
      ... on SubscriptionContractCalculationFailure {
        id
        errors {
          code
          message
        }
      }
    }
  }`;

const CALCULATION_COMMIT = `#graphql
  mutation BundleBoostPortalCalculationCommit($id: ID!) {
    subscriptionContractCalculationCommit(id: $id) {
      contract {
        ... on SubscriptionContract {
          id
          nextBillingDate
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

export type FrequencyTarget = {
  sellingPlanId: string;
  sellingPlanName: string;
  interval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  discountPercent: number;
};

type ContractLine = {
  id: string;
  quantity: number;
  variantId: string | null;
  sellingPlanId: string | null;
  customAttributes: { key: string; value: string | null }[];
  currentPrice: { amount: string };
  pricingPolicy: { basePrice: { amount: string } } | null;
};

/** The line price on the new plan: the base price less the plan's discount. */
export function priceOnPlan(line: Pick<ContractLine, "currentPrice" | "pricingPolicy">, discountPercent: number) {
  const base = line.pricingPolicy ? Number(line.pricingPolicy.basePrice.amount) : null;
  if (base === null || !Number.isFinite(base)) return Number(line.currentPrice.amount);
  return Math.round(base * (100 - discountPercent)) / 100;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Moves every line of the contract to the chosen plan (frequency) and
 * changes the billing and delivery schedule to match.
 */
export async function changeContractFrequency(
  admin: AdminGraphqlClient,
  contractId: string,
  target: FrequencyTarget,
  { pollIntervalMs = 500, maxPolls = 20 }: { pollIntervalMs?: number; maxPolls?: number } = {},
) {
  const opts = { apiVersion: CALCULATION_API_VERSION };
  const current = await adminQuery<{
    subscriptionContract: { currencyCode: string; lines: { nodes: ContractLine[] } } | null;
  }>(admin, CONTRACT_LINES, { id: contractId }, opts);
  const contract = current.subscriptionContract;
  if (!contract) throw new ShopifyApiError("Shopify couldn't find this subscription.");

  const cadence = { unit: target.interval, count: target.intervalCount };
  const input = {
    withMerchandiseCustomizations: false,
    billingPolicy: { anchors: [], cadence },
    deliveryPolicy: { anchors: [], cadence },
    lines: contract.lines.nodes
      .filter((line) => line.variantId)
      .map((line) => ({
        productVariantLine: {
          id: line.id,
          productVariantId: line.variantId,
          quantity: line.quantity,
          sellingPlanName: target.sellingPlanName,
          originSellingPlanId: target.sellingPlanId,
          priceOverride: {
            amount: priceOnPlan(line, target.discountPercent).toFixed(2),
            currencyCode: contract.currencyCode,
          },
          // Lines are replaced whole: keep the line's attributes.
          customAttributes: line.customAttributes.map((a) => ({ key: a.key, value: a.value ?? "" })),
          discounts: [],
        },
      })),
  };

  const calculated = await adminQuery<{
    subscriptionContractUpdateCalculate: {
      subscriptionContractCalculation: { id?: string } | null;
      userErrors: UserError[];
    };
  }>(admin, UPDATE_CALCULATE, { contractId, input }, opts);
  assertNoUserErrors(calculated.subscriptionContractUpdateCalculate.userErrors);
  const calculationId = calculated.subscriptionContractUpdateCalculate.subscriptionContractCalculation?.id;
  if (!calculationId) throw new ShopifyApiError("Shopify couldn't change the delivery frequency.");

  for (let poll = 0; ; poll += 1) {
    const result = await adminQuery<{
      subscriptionContractCalculation: { __typename: string; errors?: { message: string }[] } | null;
    }>(admin, CALCULATION, { id: calculationId }, opts);
    const state = result.subscriptionContractCalculation;
    if (state?.__typename === "SubscriptionContractCalculationSuccess") break;
    if (!state || state.__typename === "SubscriptionContractCalculationFailure") {
      throw new ShopifyApiError(
        state?.errors?.map((e) => e.message).join("; ") || "Shopify couldn't change the delivery frequency.",
      );
    }
    if (poll >= maxPolls) throw new ShopifyApiError("Shopify is taking too long. Please try again in a minute.");
    await sleep(pollIntervalMs);
  }

  const committed = await adminQuery<{
    subscriptionContractCalculationCommit: {
      contract: { id: string; nextBillingDate: string | null } | null;
      userErrors: UserError[];
    };
  }>(admin, CALCULATION_COMMIT, { id: calculationId }, opts);
  assertNoUserErrors(committed.subscriptionContractCalculationCommit.userErrors);
  return { nextBillingDate: committed.subscriptionContractCalculationCommit.contract?.nextBillingDate ?? null };
}

// ---------------------------------------------------------------------------
// Payment method
// ---------------------------------------------------------------------------

const SEND_UPDATE_EMAIL = `#graphql
  mutation BundleBoostPortalPaymentUpdateEmail($id: ID!) {
    customerPaymentMethodSendUpdateEmail(customerPaymentMethodId: $id) {
      customer {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

/**
 * Shopify emails the customer a secure link to update the card used for the
 * subscription (BundleBoost never sees card details). Needs write_customers.
 */
export async function sendPaymentMethodUpdateEmail(admin: AdminGraphqlClient, paymentMethodId: string) {
  const data = await adminQuery<{ customerPaymentMethodSendUpdateEmail: { userErrors: UserError[] } }>(
    admin,
    SEND_UPDATE_EMAIL,
    { id: paymentMethodId },
  );
  assertNoUserErrors(data.customerPaymentMethodSendUpdateEmail.userErrors);
}
