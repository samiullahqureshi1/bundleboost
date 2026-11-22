import { beforeEach, describe, expect, it } from "vitest";
import { syncContractFromShopify } from "../../app/.server/services/subscription-contract.service";
import {
  describeFrequency,
  listPortalSubscriptions,
  parsePortalAction,
  runPortalAction,
  type PortalCustomer,
} from "../../app/.server/services/subscription-portal.service";
import { priceOnPlan } from "../../app/.server/shopify/subscription-portal";
import { createAdminDouble } from "../support/admin-graphql-double";
import { createShop, prisma, resetDatabase } from "../support/db";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-01T12:00:00Z");
const CONTRACT = "gid://shopify/SubscriptionContract/1";
const OTHERS = "gid://shopify/SubscriptionContract/2";
const CUSTOMER = "gid://shopify/Customer/7";
const MONTHLY = "gid://shopify/SellingPlan/501";
const QUARTERLY = "gid://shopify/SellingPlan/502";

let store: ReturnType<typeof createAdminDouble>;
let shopId: string;
let ctx: PortalCustomer;
let frequencies: { monthly: string; quarterly: string };

beforeEach(async () => {
  await resetDatabase();
  shopId = (await createShop("portal.myshopify.com")).id;
  store = createAdminDouble([]);
  ctx = { shopId, customerGid: CUSTOMER, admin: store.client };

  const plan = await prisma.subscriptionPlan.create({
    data: {
      shopId,
      name: "Subscribe & save",
      syncStatus: "SYNCED",
      frequencies: {
        create: [
          { interval: "MONTH", intervalCount: 1, discountPercent: "10.00", position: 0, shopifySellingPlanId: MONTHLY },
          { interval: "MONTH", intervalCount: 3, discountPercent: "15.00", position: 1, shopifySellingPlanId: QUARTERLY, label: "Quarterly" },
        ],
      },
    },
    include: { frequencies: { orderBy: { position: "asc" } } },
  });
  frequencies = { monthly: plan.frequencies[0].id, quarterly: plan.frequencies[1].id };

  store.addContract(CONTRACT, new Date(NOW.getTime() + 5 * DAY), 30);
  store.setContractPlan(CONTRACT, MONTHLY, "MONTH", 1);
  // Someone else's subscription in the same store.
  store.addContract(OTHERS, new Date(NOW.getTime() + 5 * DAY), 30, {
    id: "gid://shopify/Customer/99",
    displayName: "Other",
    email: "other@example.com",
  });
  await syncContractFromShopify(store.client, shopId, CONTRACT);
});

describe("customer subscription portal", () => {
  it("lists only the signed-in customer's subscriptions with everything the page shows", async () => {
    const [subscription, ...rest] = await listPortalSubscriptions(ctx, NOW);
    expect(rest).toHaveLength(0);
    expect(subscription).toMatchObject({
      id: CONTRACT,
      status: "ACTIVE",
      amount: "18.00",
      deliveryPrice: "4.99",
      frequency: "Every month",
      payment: { description: "Visa ending in 4242", expires: "04/2029" },
      orders: [{ name: "#1001", fulfillment: "FULFILLED" }],
    });
    expect(subscription.nextBillingDate).toBeTruthy();
    expect(subscription.frequencies.map((f) => [f.label, f.current])).toEqual([
      ["Delivery every month", true],
      ["Quarterly", false],
    ]);
  });

  it("creates the local copy when a subscription's webhook was missed", async () => {
    await prisma.subscriptionContract.deleteMany();
    const [subscription] = await listPortalSubscriptions(ctx, NOW);
    expect(subscription.id).toBe(CONTRACT);
    expect(await prisma.subscriptionContract.count()).toBe(1);
  });

  it("skips the next order and brings it back", async () => {
    const skipped = await runPortalAction(ctx, { contractId: CONTRACT, action: "skip" }, NOW);
    expect(skipped.skippedDate).toBeTruthy();
    expect(new Date(skipped.nextBillingDate!).getTime()).toBeGreaterThan(new Date(skipped.skippedDate!).getTime());

    const back = await runPortalAction(ctx, { contractId: CONTRACT, action: "unskip" }, NOW);
    expect(back.skippedDate).toBeNull();
  });

  it("pauses, resumes and cancels, recording the customer as the actor", async () => {
    expect((await runPortalAction(ctx, { contractId: CONTRACT, action: "pause" }, NOW)).status).toBe("PAUSED");
    expect((await runPortalAction(ctx, { contractId: CONTRACT, action: "resume" }, NOW)).status).toBe("ACTIVE");
    expect((await runPortalAction(ctx, { contractId: CONTRACT, action: "cancel" }, NOW)).status).toBe("CANCELLED");

    const audit = await prisma.auditLog.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.action, a.actorId])).toEqual([
      ["subscription.pause", "customer"],
      ["subscription.resume", "customer"],
      ["subscription.cancel", "customer"],
    ]);
  });

  it("refuses changes that no longer apply (e.g. resuming a cancelled subscription)", async () => {
    await runPortalAction(ctx, { contractId: CONTRACT, action: "cancel" }, NOW);
    await expect(runPortalAction(ctx, { contractId: CONTRACT, action: "resume" }, NOW)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("never shows or changes another customer's subscription", async () => {
    await syncContractFromShopify(store.client, shopId, OTHERS);
    await expect(runPortalAction(ctx, { contractId: OTHERS, action: "cancel" }, NOW)).rejects.toMatchObject({
      status: 404,
    });
    expect(store.contract(OTHERS)!.status).toBe("ACTIVE");
    await expect(
      runPortalAction(ctx, { contractId: "gid://shopify/SubscriptionContract/404", action: "pause" }, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("changes the delivery frequency to another of the plan's frequencies, with its price", async () => {
    const updated = await runPortalAction(
      ctx,
      { contractId: CONTRACT, action: "frequency", frequencyId: frequencies.quarterly },
      NOW,
    );
    expect(updated.frequency).toBe("Every 3 months");
    expect(updated.frequencies.find((f) => f.current)?.label).toBe("Quarterly");
    // Base price 10.00 less the quarterly 15%.
    expect(store.contract(CONTRACT)!.linePrice).toBe("8.50");

    // The Calculation API is called on 2026-10, keeping the line's attributes.
    const calculate = store.calls.find((c) => c.query.includes("BundleBoostPortalUpdateCalculate"))!;
    expect(calculate.apiVersion).toBe("2026-10");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = (calculate.variables as any).input.lines[0].productVariantLine;
    expect(line).toMatchObject({ originSellingPlanId: QUARTERLY, sellingPlanName: "Quarterly", customAttributes: [{ key: "gift", value: "no" }] });

    const local = await prisma.subscriptionContract.findUniqueOrThrow({ where: { shopifyContractId: CONTRACT } });
    expect([local.interval, local.intervalCount]).toEqual(["MONTH", 3]);
  });

  it("only offers frequencies from the subscription's own plan", async () => {
    const otherPlan = await prisma.subscriptionPlan.create({
      data: {
        shopId,
        name: "Other",
        frequencies: { create: [{ interval: "WEEK", intervalCount: 1, position: 0, shopifySellingPlanId: "gid://shopify/SellingPlan/900" }] },
      },
      include: { frequencies: true },
    });
    await expect(
      runPortalAction(ctx, { contractId: CONTRACT, action: "frequency", frequencyId: otherPlan.frequencies[0].id }, NOW),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("emails Shopify's secure payment update link", async () => {
    await runPortalAction(ctx, { contractId: CONTRACT, action: "payment" }, NOW);
    expect(store.contract(CONTRACT)!.paymentUpdateEmails).toBe(1);
  });
});

describe("portal helpers", () => {
  it("parses requests and rejects unknown actions", () => {
    expect(parsePortalAction({ contractId: CONTRACT, action: "skip" })).toEqual({ contractId: CONTRACT, action: "skip" });
    expect(() => parsePortalAction({ contractId: CONTRACT, action: "delete" })).toThrow();
    expect(() => parsePortalAction({ action: "skip" })).toThrow();
    expect(() => parsePortalAction({ contractId: CONTRACT, action: "frequency" })).toThrow();
  });

  it("describes frequencies and prices lines on a plan", () => {
    expect(describeFrequency("WEEK", 1)).toBe("Every week");
    expect(describeFrequency("MONTH", 2)).toBe("Every 2 months");
    expect(priceOnPlan({ currentPrice: { amount: "9.00" }, pricingPolicy: { basePrice: { amount: "19.99" } } }, 10)).toBe(17.99);
    expect(priceOnPlan({ currentPrice: { amount: "9.00" }, pricingPolicy: null }, 10)).toBe(9);
  });
});
