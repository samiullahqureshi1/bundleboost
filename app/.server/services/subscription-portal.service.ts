import prisma from "../../db.server";
import { frequencyName, type FrequencyIntervalValue } from "../../lib/subscription-plans";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { logger } from "../logger";
import type { AdminGraphqlClient } from "../shopify/graphql";
import {
  changeContractFrequency,
  fetchCustomerContracts,
  fetchPortalContract,
  sendPaymentMethodUpdateEmail,
  type PortalShopifyContract,
} from "../shopify/subscription-portal";
import { recordAudit } from "./audit.service";
import { changeContract, syncContractFromShopify, type ContractAction } from "./subscription-contract.service";

/**
 * The customer subscription portal ("My subscriptions" in Shopify customer
 * accounts). The customer is identified by Shopify's customer-account session
 * token; every subscription is checked to belong to that customer before it's
 * shown or changed. Customers change their own subscriptions here without
 * contacting the merchant.
 */

export type PortalCustomer = { shopId: string; customerGid: string; admin: AdminGraphqlClient };

/** Audit actor for changes customers make themselves (no personal data). */
const CUSTOMER_ACTOR = "customer";

export type PortalFrequency = { id: string; label: string; discountPercent: number; current: boolean };

export type PortalSubscription = {
  id: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED" | "FAILED";
  createdAt: string;
  currencyCode: string;
  /** Per renewal, before shipping. */
  amount: string;
  deliveryPrice: string | null;
  frequency: string;
  nextBillingDate: string | null;
  /** The order the customer skipped and can still bring back. */
  skippedDate: string | null;
  lines: { title: string; variantTitle: string | null; quantity: number; price: string; imageUrl: string | null; imageAlt: string | null }[];
  payment: { id: string; description: string; expires: string | null } | null;
  frequencies: PortalFrequency[];
  orders: { id: string; name: string; createdAt: string; total: string; currencyCode: string; fulfillment: string }[];
  /** Renewal charges that didn't go through (most recent first). */
  failedCharges: { date: string; message: string }[];
};

const UNIT_LABEL: Record<string, [string, string]> = {
  DAY: ["day", "days"],
  WEEK: ["week", "weeks"],
  MONTH: ["month", "months"],
  YEAR: ["year", "years"],
};

/** "Every month", "Every 2 weeks". */
export function describeFrequency(interval: string, count: number) {
  const unit = UNIT_LABEL[interval] ?? [interval.toLowerCase(), interval.toLowerCase()];
  return count === 1 ? `Every ${unit[0]}` : `Every ${count} ${unit[1]}`;
}

function describePayment(method: PortalShopifyContract["customerPaymentMethod"]): PortalSubscription["payment"] {
  if (!method) return null;
  const i = method.instrument;
  const expires = i?.expiryMonth && i.expiryYear ? `${String(i.expiryMonth).padStart(2, "0")}/${i.expiryYear}` : null;
  if (i?.__typename === "CustomerCreditCard") {
    const brand = i.brand ? i.brand.charAt(0).toUpperCase() + i.brand.slice(1) : "Card";
    return { id: method.id, description: `${brand} ending in ${i.lastDigits ?? "••••"}`, expires };
  }
  if (i?.__typename === "CustomerShopPayAgreement") {
    return { id: method.id, description: `Shop Pay ending in ${i.lastDigits ?? "••••"}`, expires };
  }
  if (i?.__typename === "CustomerPaypalBillingAgreement") {
    return { id: method.id, description: "PayPal", expires: null };
  }
  return { id: method.id, description: "Saved payment method", expires };
}

/** The plan's other frequencies the customer can switch to (BundleBoost plans only). */
async function frequencyChoices(shopId: string, contract: PortalShopifyContract): Promise<PortalFrequency[]> {
  const planIds = contract.lines.nodes.map((l) => l.sellingPlanId).filter((id): id is string => Boolean(id));
  if (!planIds.length) return [];
  const current = await prisma.subscriptionFrequency.findFirst({
    where: { shopifySellingPlanId: { in: planIds }, plan: { shopId } },
    select: { planId: true, shopifySellingPlanId: true },
  });
  if (!current) return [];
  const all = await prisma.subscriptionFrequency.findMany({
    where: { planId: current.planId, shopifySellingPlanId: { not: null } },
    orderBy: { position: "asc" },
  });
  return all.map((f) => ({
    id: f.id,
    label: f.label || frequencyName(f.interval as FrequencyIntervalValue, f.intervalCount),
    discountPercent: Number(f.discountPercent),
    current: f.shopifySellingPlanId === current.shopifySellingPlanId,
  }));
}

/** The local copy of the contract, created from Shopify if a webhook was missed. */
async function localContract(ctx: PortalCustomer, contractGid: string) {
  const existing = await prisma.subscriptionContract.findFirst({
    where: { shopId: ctx.shopId, shopifyContractId: contractGid },
  });
  if (existing) return existing;
  await syncContractFromShopify(ctx.admin, ctx.shopId, contractGid);
  return prisma.subscriptionContract.findFirst({ where: { shopId: ctx.shopId, shopifyContractId: contractGid } });
}

async function toPortalSubscription(ctx: PortalCustomer, contract: PortalShopifyContract, now: Date) {
  const local = await localContract(ctx, contract.id);
  const amount = contract.lines.nodes.reduce((sum, l) => sum + Number(l.currentPrice.amount) * l.quantity, 0);
  const failed = local
    ? await prisma.subscriptionBillingAttempt.findMany({
        where: { contractId: local.id, status: { in: ["FAILED", "ACTION_REQUIRED"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];
  const status = (local?.status ?? contract.status) as PortalSubscription["status"];
  const subscription: PortalSubscription = {
    id: contract.id,
    status,
    createdAt: contract.createdAt,
    currencyCode: contract.currencyCode,
    amount: amount.toFixed(2),
    deliveryPrice: contract.deliveryPrice?.amount ?? null,
    frequency: describeFrequency(contract.billingPolicy.interval, contract.billingPolicy.intervalCount),
    // Ours knows about skipped orders and renewals in progress.
    nextBillingDate: (local?.nextBillingDate?.toISOString() ?? contract.nextBillingDate) || null,
    skippedDate:
      local?.skippedCycleDate && local.skippedCycleDate > now ? local.skippedCycleDate.toISOString() : null,
    lines: contract.lines.nodes.map((l) => ({
      title: l.title,
      variantTitle: l.variantTitle,
      quantity: l.quantity,
      price: l.currentPrice.amount,
      imageUrl: l.variantImage?.url ?? null,
      imageAlt: l.variantImage?.altText ?? null,
    })),
    payment: describePayment(contract.customerPaymentMethod),
    frequencies: status === "CANCELLED" || status === "EXPIRED" ? [] : await frequencyChoices(ctx.shopId, contract),
    orders: contract.orders.nodes.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      total: o.totalPriceSet.shopMoney.amount,
      currencyCode: o.totalPriceSet.shopMoney.currencyCode,
      fulfillment: o.displayFulfillmentStatus,
    })),
    failedCharges: failed.map((a) => ({
      date: a.createdAt.toISOString(),
      message: a.status === "ACTION_REQUIRED" ? "Your bank asked for confirmation" : "The payment didn't go through",
    })),
  };
  return subscription;
}

/** The signed-in customer's BundleBoost subscriptions: active and paused first, then past ones. */
export async function listPortalSubscriptions(ctx: PortalCustomer, now = new Date()) {
  const contracts = await fetchCustomerContracts(ctx.admin, ctx.customerGid);
  const subscriptions: PortalSubscription[] = [];
  for (const contract of contracts) {
    // Only contracts that are really this customer's (defence in depth).
    if (contract.customer?.id !== ctx.customerGid) continue;
    subscriptions.push(await toPortalSubscription(ctx, contract, now));
  }
  const rank = (s: PortalSubscription) => (s.status === "ACTIVE" ? 0 : s.status === "PAUSED" || s.status === "FAILED" ? 1 : 2);
  return subscriptions.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

/** Loads the contract and checks it belongs to the signed-in customer. */
async function ownedContract(ctx: PortalCustomer, contractGid: string) {
  if (!/^gid:\/\/shopify\/SubscriptionContract\/\d+$/.test(contractGid)) throw new NotFoundError("Subscription");
  const contract = await fetchPortalContract(ctx.admin, contractGid);
  if (!contract || contract.customer?.id !== ctx.customerGid) throw new NotFoundError("Subscription");
  return contract;
}

export type PortalAction =
  | { action: ContractAction }
  | { action: "frequency"; frequencyId: string }
  | { action: "payment" };

const STATUS_ACTIONS: ContractAction[] = ["skip", "unskip", "pause", "resume", "cancel"];

/** What each action may be done from, so a stale page can't e.g. resume a cancelled subscription. */
const ALLOWED_FROM: Record<string, string[]> = {
  skip: ["ACTIVE"],
  unskip: ["ACTIVE", "PAUSED"],
  pause: ["ACTIVE", "FAILED"],
  resume: ["PAUSED", "FAILED"],
  cancel: ["ACTIVE", "PAUSED", "FAILED"],
  frequency: ["ACTIVE", "PAUSED"],
  payment: ["ACTIVE", "PAUSED", "FAILED"],
};

export function parsePortalAction(raw: unknown): PortalAction & { contractId: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const contractId = typeof body.contractId === "string" ? body.contractId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!contractId) throw new ValidationError({ contractId: "Choose a subscription" });
  if ((STATUS_ACTIONS as string[]).includes(action)) return { contractId, action: action as ContractAction };
  if (action === "payment") return { contractId, action };
  if (action === "frequency") {
    const frequencyId = typeof body.frequencyId === "string" ? body.frequencyId : "";
    if (!frequencyId) throw new ValidationError({ frequencyId: "Choose a delivery frequency" });
    return { contractId, action, frequencyId };
  }
  throw new ValidationError({ action: "Unknown action" });
}

/** Runs a change the customer asked for and returns their updated subscription. */
export async function runPortalAction(
  ctx: PortalCustomer,
  request: PortalAction & { contractId: string },
  now = new Date(),
) {
  const contract = await ownedContract(ctx, request.contractId);
  const local = await localContract(ctx, contract.id);
  if (!local) throw new NotFoundError("Subscription");
  if (!ALLOWED_FROM[request.action].includes(local.status)) {
    throw new ConflictError("This subscription can't be changed that way any more. Refresh the page.");
  }

  if (request.action === "payment") {
    if (!contract.customerPaymentMethod) throw new ConflictError("There's no saved payment method to update.");
    await sendPaymentMethodUpdateEmail(ctx.admin, contract.customerPaymentMethod.id);
    await audit(ctx, local.id, "subscription.payment_update_requested");
  } else if (request.action === "frequency") {
    const choices = await frequencyChoices(ctx.shopId, contract);
    const choice = choices.find((c) => c.id === request.frequencyId);
    if (!choice) throw new ValidationError({ frequencyId: "That delivery frequency isn't available" });
    if (!choice.current) {
      const frequency = await prisma.subscriptionFrequency.findUniqueOrThrow({ where: { id: choice.id } });
      await changeContractFrequency(ctx.admin, contract.id, {
        sellingPlanId: frequency.shopifySellingPlanId!,
        sellingPlanName: choice.label,
        interval: frequency.interval,
        intervalCount: frequency.intervalCount,
        discountPercent: Number(frequency.discountPercent),
      });
      await syncContractFromShopify(ctx.admin, ctx.shopId, contract.id);
      await audit(ctx, local.id, "subscription.frequency_changed");
    }
  } else {
    await changeContract({ shopId: ctx.shopId, actorId: CUSTOMER_ACTOR, admin: ctx.admin }, local.id, request.action, now);
  }

  const fresh = await fetchPortalContract(ctx.admin, contract.id);
  if (!fresh) throw new NotFoundError("Subscription");
  return toPortalSubscription(ctx, fresh, now);
}

async function audit(ctx: PortalCustomer, entityId: string, action: string) {
  try {
    await recordAudit({ shopId: ctx.shopId, actorId: CUSTOMER_ACTOR, action, entityType: "SubscriptionContract", entityId });
  } catch (error) {
    logger.warn("Portal audit failed", { shopId: ctx.shopId, error });
  }
}
