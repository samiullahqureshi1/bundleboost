import type { ContractStatus } from "@prisma/client";
import prisma from "../../db.server";
import { ConflictError, NotFoundError } from "../errors";
import { logger } from "../logger";
import type { AdminGraphqlClient } from "../shopify/graphql";
import {
  chargeBillingCycle,
  fetchBillingCycle,
  fetchContract,
  setContractStatus,
  skipBillingCycle,
  unskipBillingCycle,
} from "../shopify/subscription-contracts";
import { recordAudit } from "./audit.service";

/**
 * Subscriptions bought on BundleBoost plans and their renewals.
 *
 * Shopify bills the first order at checkout and creates the contract. Every
 * renewal after that is BundleBoost's job: `runRenewals` charges each due
 * billing cycle (Shopify's subscriptionBillingCycleCharge), and the result
 * arrives on the subscription_billing_attempts webhooks. Failed charges are
 * retried (dunning) and the subscription is paused after the last attempt.
 */

/** Days to wait before retrying a failed charge, by failure number. */
export const RETRY_AFTER_DAYS = [1, 3];
/** Failed charges in a row before the subscription is paused. */
export const MAX_FAILED_ATTEMPTS = RETRY_AFTER_DAYS.length + 1;
const DAY_MS = 24 * 60 * 60 * 1000;
// A charge still pending after this long is treated as lost and started again.
const PENDING_TIMEOUT_MS = DAY_MS;

const STATUS: Record<string, ContractStatus> = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  FAILED: "FAILED",
};

const toStatus = (s: string): ContractStatus => STATUS[s] ?? "ACTIVE";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/**
 * Creates or refreshes the local copy of a contract from Shopify
 * (subscription_contracts/create and /update webhooks).
 */
export async function syncContractFromShopify(admin: AdminGraphqlClient, shopId: string, contractGid: string) {
  const contract = await fetchContract(admin, contractGid);
  if (!contract) {
    logger.warn("Subscription contract not found in Shopify", { shopId, contractGid });
    return null;
  }
  const lines = contract.lines.nodes.map((l) => ({
    title: l.title,
    variantTitle: l.variantTitle,
    quantity: l.quantity,
  }));
  const amount = contract.lines.nodes.reduce((sum, l) => sum + Number(l.currentPrice.amount) * l.quantity, 0);
  const shopifyNext = contract.nextBillingDate ? new Date(contract.nextBillingDate) : null;
  const existing = await prisma.subscriptionContract.findUnique({ where: { shopifyContractId: contract.id } });
  // Keep our date when it's later: after a renewal we move it to the next
  // cycle, which Shopify's contract may not reflect yet.
  const nextBillingDate =
    existing?.nextBillingDate && shopifyNext && existing.nextBillingDate > shopifyNext
      ? existing.nextBillingDate
      : shopifyNext;
  const data = {
    status: toStatus(contract.status),
    interval: contract.billingPolicy.interval,
    intervalCount: contract.billingPolicy.intervalCount,
    currencyCode: contract.currencyCode,
    amount: amount.toFixed(2),
    lines,
    nextBillingDate,
    ...(contract.customer !== undefined
      ? {
          customerGid: contract.customer?.id ?? null,
          customerName: contract.customer?.displayName ?? null,
          customerEmail: contract.customer?.defaultEmailAddress?.emailAddress ?? null,
        }
      : {}),
    ...(contract.originOrder !== undefined
      ? { originOrderName: contract.originOrder?.name ?? null, originOrderGid: contract.originOrder?.id ?? null }
      : {}),
  };
  return prisma.subscriptionContract.upsert({
    where: { shopifyContractId: contract.id },
    create: { shopId, shopifyContractId: contract.id, ...data },
    update: data,
  });
}

export async function listContracts(shopId: string) {
  return prisma.subscriptionContract.findMany({
    where: { shopId },
    orderBy: [{ status: "asc" }, { nextBillingDate: "asc" }],
    include: { billingAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    take: 250,
  });
}

async function getContract(shopId: string, id: string) {
  const contract = await prisma.subscriptionContract.findFirst({ where: { id, shopId } });
  if (!contract) throw new NotFoundError("Subscription");
  return contract;
}

/** The next cycle's due date, after `cycleIndex`. */
async function nextCycleDate(admin: AdminGraphqlClient, contractGid: string, cycleIndex: number) {
  const next = await fetchBillingCycle(admin, contractGid, { index: cycleIndex + 1 });
  return next ? new Date(next.billingAttemptExpectedDate) : null;
}

// ---------------------------------------------------------------------------
// Renewals
// ---------------------------------------------------------------------------

export type RenewalSummary = { charged: number; advanced: number; failed: number };

/**
 * Charges every due renewal for one shop. Safe to run repeatedly (e.g. every
 * hour): a cycle with a charge in progress or already billed isn't charged
 * again.
 */
export async function runRenewals(admin: AdminGraphqlClient, shopId: string, now = new Date()): Promise<RenewalSummary> {
  const summary: RenewalSummary = { charged: 0, advanced: 0, failed: 0 };
  const due = await prisma.subscriptionContract.findMany({
    where: {
      shopId,
      status: "ACTIVE",
      OR: [
        { failedAttempts: 0, nextBillingDate: { lte: now } },
        { failedAttempts: { gt: 0 }, nextRetryAt: { lte: now } },
      ],
    },
    take: 100,
  });

  for (const contract of due) {
    try {
      if (!contract.nextBillingDate) continue;
      const cycle = await fetchBillingCycle(admin, contract.shopifyContractId, {
        date: contract.nextBillingDate.toISOString(),
      });
      if (!cycle) continue;

      // Skipped or already billed (e.g. charged elsewhere): move on.
      if (cycle.skipped || cycle.status === "BILLED") {
        await prisma.subscriptionContract.update({
          where: { id: contract.id },
          data: {
            nextBillingDate: await nextCycleDate(admin, contract.shopifyContractId, cycle.cycleIndex),
            failedAttempts: 0,
            nextRetryAt: null,
          },
        });
        summary.advanced++;
        continue;
      }

      const pending = await prisma.subscriptionBillingAttempt.findFirst({
        where: {
          contractId: contract.id,
          cycleIndex: cycle.cycleIndex,
          status: "PENDING",
          // Real time, not `now`: this is how long Shopify has been processing.
          createdAt: { gt: new Date(Date.now() - PENDING_TIMEOUT_MS) },
        },
      });
      if (pending) continue;

      const attemptId = await chargeBillingCycle(admin, contract.shopifyContractId, cycle.cycleIndex);
      await prisma.$transaction([
        prisma.subscriptionBillingAttempt.create({
          data: { contractId: contract.id, cycleIndex: cycle.cycleIndex, shopifyAttemptId: attemptId },
        }),
        // Wait for the result webhook before trying again.
        prisma.subscriptionContract.update({ where: { id: contract.id }, data: { nextRetryAt: null } }),
      ]);
      summary.charged++;
    } catch (error) {
      summary.failed++;
      logger.warn("Renewal charge could not be started", { shopId, contractId: contract.id, error });
      await recordFailure(admin, contract.id, {
        code: "CHARGE_NOT_STARTED",
        message: error instanceof Error ? error.message : "The charge couldn't be started",
        now,
      });
    }
  }
  return summary;
}

/** Shops with a renewal or retry due, for the scheduled job. */
export async function shopsWithDueRenewals(now = new Date()) {
  const rows = await prisma.subscriptionContract.findMany({
    where: {
      status: "ACTIVE",
      shop: { uninstalledAt: null },
      OR: [
        { failedAttempts: 0, nextBillingDate: { lte: now } },
        { failedAttempts: { gt: 0 }, nextRetryAt: { lte: now } },
      ],
    },
    distinct: ["shopId"],
    select: { shopId: true, shop: { select: { domain: true } } },
  });
  return rows.map((r) => ({ shopId: r.shopId, domain: r.shop.domain }));
}

type AttemptWebhook = {
  admin_graphql_api_id?: string | null;
  admin_graphql_api_subscription_contract_id?: string | null;
  admin_graphql_api_order_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};

/** subscription_billing_attempts/success | failure | challenged */
export async function handleBillingAttemptWebhook(
  admin: AdminGraphqlClient,
  shopId: string,
  topic: "success" | "failure" | "challenged",
  payload: AttemptWebhook,
  now = new Date(),
) {
  const contractGid = payload.admin_graphql_api_subscription_contract_id;
  if (!contractGid) return;
  const contract = await prisma.subscriptionContract.findUnique({ where: { shopifyContractId: contractGid } });
  if (!contract || contract.shopId !== shopId) {
    logger.warn("Billing attempt for an unknown subscription", { shopId, contractGid });
    return;
  }
  const attempt =
    (payload.admin_graphql_api_id &&
      (await prisma.subscriptionBillingAttempt.findUnique({ where: { shopifyAttemptId: payload.admin_graphql_api_id } }))) ||
    (await prisma.subscriptionBillingAttempt.findFirst({
      where: { contractId: contract.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }));

  if (topic === "success") {
    if (attempt) {
      await prisma.subscriptionBillingAttempt.update({
        where: { id: attempt.id },
        data: { status: "SUCCEEDED", orderGid: payload.admin_graphql_api_order_id ?? null, errorCode: null, errorMessage: null },
      });
    }
    const next = attempt ? await nextCycleDate(admin, contractGid, attempt.cycleIndex) : contract.nextBillingDate;
    await prisma.subscriptionContract.update({
      where: { id: contract.id },
      data: { failedAttempts: 0, nextRetryAt: null, lastBilledAt: now, nextBillingDate: next },
    });
    return;
  }

  if (attempt) {
    await prisma.subscriptionBillingAttempt.update({
      where: { id: attempt.id },
      data: {
        status: topic === "challenged" ? "ACTION_REQUIRED" : "FAILED",
        errorCode: payload.error_code ?? null,
        errorMessage: payload.error_message ?? null,
      },
    });
  }
  await recordFailure(admin, contract.id, {
    code: payload.error_code ?? (topic === "challenged" ? "AUTHENTICATION_REQUIRED" : "PAYMENT_FAILED"),
    message: payload.error_message ?? null,
    now,
  });
}

/** Dunning: schedule a retry, or pause the subscription after the last one. */
async function recordFailure(
  admin: AdminGraphqlClient,
  contractId: string,
  failure: { code: string; message: string | null; now: Date },
) {
  const contract = await prisma.subscriptionContract.findUniqueOrThrow({ where: { id: contractId } });
  const failedAttempts = contract.failedAttempts + 1;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    let status: ContractStatus = "PAUSED";
    try {
      status = toStatus(await setContractStatus(admin, contract.shopifyContractId, "pause"));
    } catch (error) {
      logger.warn("Could not pause subscription after failed charges", { contractId, error });
    }
    await prisma.subscriptionContract.update({
      where: { id: contractId },
      data: { failedAttempts, nextRetryAt: null, status },
    });
    await recordAudit({
      shopId: contract.shopId,
      actorId: null,
      action: "subscription.paused_after_failed_payments",
      entityType: "SubscriptionContract",
      entityId: contractId,
      metadata: { code: failure.code, attempts: failedAttempts },
    });
    return;
  }
  const retryAt = new Date(failure.now.getTime() + RETRY_AFTER_DAYS[failedAttempts - 1] * DAY_MS);
  await prisma.subscriptionContract.update({
    where: { id: contractId },
    data: { failedAttempts, nextRetryAt: retryAt },
  });
}

// ---------------------------------------------------------------------------
// Merchant actions
// ---------------------------------------------------------------------------

export type ContractAction = "pause" | "resume" | "cancel" | "skip" | "unskip";

export async function changeContract(
  ctx: { shopId: string; actorId: string | null; admin: AdminGraphqlClient },
  id: string,
  action: ContractAction,
  now = new Date(),
) {
  const contract = await getContract(ctx.shopId, id);
  let data: Parameters<typeof prisma.subscriptionContract.update>[0]["data"];
  if (action === "skip") {
    if (!contract.nextBillingDate) throw new ConflictError("There's no upcoming order to skip");
    const cycle = await fetchBillingCycle(ctx.admin, contract.shopifyContractId, {
      date: contract.nextBillingDate.toISOString(),
    });
    if (!cycle) throw new ConflictError("There's no upcoming order to skip");
    await skipBillingCycle(ctx.admin, contract.shopifyContractId, cycle.cycleIndex);
    data = {
      nextBillingDate: await nextCycleDate(ctx.admin, contract.shopifyContractId, cycle.cycleIndex),
      failedAttempts: 0,
      nextRetryAt: null,
      // Remembered so the merchant sees "Next order skipped" and can undo it.
      skippedCycleIndex: cycle.cycleIndex,
      skippedCycleDate: new Date(cycle.billingAttemptExpectedDate),
    };
  } else if (action === "unskip") {
    if (contract.skippedCycleIndex === null || !contract.skippedCycleDate) {
      throw new ConflictError("There's no skipped order to bring back");
    }
    if (contract.skippedCycleDate <= now) {
      throw new ConflictError("That order's date has already passed");
    }
    await unskipBillingCycle(ctx.admin, contract.shopifyContractId, contract.skippedCycleIndex);
    data = {
      // The restored order is the next one again (unless an earlier one is due).
      nextBillingDate:
        contract.nextBillingDate && contract.nextBillingDate < contract.skippedCycleDate
          ? contract.nextBillingDate
          : contract.skippedCycleDate,
      skippedCycleIndex: null,
      skippedCycleDate: null,
    };
  } else {
    const status = await setContractStatus(
      ctx.admin,
      contract.shopifyContractId,
      action === "resume" ? "activate" : action,
    );
    data = {
      status: toStatus(status),
      // A resumed subscription starts fresh; an overdue renewal is charged
      // on the next run.
      ...(action === "resume" ? { failedAttempts: 0, nextRetryAt: null } : {}),
      ...(action === "resume" && contract.nextBillingDate && contract.nextBillingDate < now ? { nextBillingDate: now } : {}),
    };
  }
  await prisma.$transaction(async (tx) => {
    await tx.subscriptionContract.update({ where: { id }, data });
    await recordAudit(
      {
        shopId: ctx.shopId,
        actorId: ctx.actorId,
        action: `subscription.${action}`,
        entityType: "SubscriptionContract",
        entityId: id,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/** customers/redact: erase the customer's details from their subscriptions. */
export async function redactSubscriptionCustomer(shopDomain: string, customerGid: string) {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return 0;
  const result = await prisma.subscriptionContract.updateMany({
    where: { shopId: shop.id, customerGid },
    data: { customerGid: null, customerName: null, customerEmail: null, originOrderName: null, originOrderGid: null },
  });
  return result.count;
}

/** customers/data_request: what BundleBoost holds about a customer. */
export async function subscriptionDataForCustomer(shopDomain: string, customerGid: string) {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return [];
  return prisma.subscriptionContract.findMany({
    where: { shopId: shop.id, customerGid },
    select: {
      shopifyContractId: true,
      status: true,
      customerName: true,
      customerEmail: true,
      originOrderName: true,
      lines: true,
      nextBillingDate: true,
      createdAt: true,
    },
  });
}
