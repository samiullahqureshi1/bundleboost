import { beforeEach, describe, expect, it } from "vitest";
import {
  changeCampaignStatus,
  createDraftCampaign,
  deleteCampaign,
  getCampaign,
  updateCampaign,
  type TenantContext,
} from "../../app/.server/services/campaign.service";
import { ConflictError, NotFoundError, ValidationError } from "../../app/.server/errors";
import { listCampaigns } from "../../app/.server/repositories/campaign.repository";
import { createAdminDouble, fakeProduct, productGid, variantGid } from "../support/admin-graphql-double";
import { createShop, prisma, resetDatabase } from "../support/db";
import { PLANS } from "../../app/lib/plans";

const catalog = [fakeProduct(1, 3), fakeProduct(2, 1), fakeProduct(3, 2)];

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Bulk socks",
    discountType: "PERCENTAGE",
    products: [{ productGid: productGid(1), variantGids: [] }],
    tiers: [
      { minQuantity: 2, value: "5" },
      { minQuantity: 4, value: "12.5", label: "Best value" },
    ],
    ...overrides,
  };
}

let shopA: TenantContext;
let shopB: TenantContext;

beforeEach(async () => {
  await resetDatabase();
  const a = await createShop("shop-a.myshopify.com");
  const b = await createShop("shop-b.myshopify.com");
  shopA = { shopId: a.id, actorId: "1001", admin: createAdminDouble(catalog).client, plan: PLANS.pro };
  shopB = { shopId: b.id, actorId: "2002", admin: createAdminDouble(catalog).client, plan: PLANS.pro };
});

describe("createDraftCampaign", () => {
  it("persists a draft with targets, ordered tiers and an audit entry", async () => {
    const campaign = await createDraftCampaign(shopA, input());

    expect(campaign.status).toBe("DRAFT");
    expect(campaign.shopifyDiscountId).toBeNull();
    expect(campaign.products).toHaveLength(1);
    expect(campaign.products[0]).toMatchObject({ productGid: productGid(1), title: "Product 1" });
    expect(campaign.tiers.map((t) => [t.minQuantity, t.value.toString(), t.label])).toEqual([
      [2, "5", null],
      [4, "12.5", "Best value"],
    ]);

    const audit = await prisma.auditLog.findMany({ where: { shopId: shopA.shopId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "campaign.created", entityId: campaign.id, actorId: "1001" });
  });

  it("stores titles from Shopify, not from the client", async () => {
    const campaign = await createDraftCampaign(
      shopA,
      input({ products: [{ productGid: productGid(1), variantGids: [], title: "<script>" }] }),
    );
    expect(campaign.products[0].title).toBe("Product 1");
  });

  it("keeps an explicit variant subset and collapses 'all variants' to the product", async () => {
    const subset = await createDraftCampaign(
      shopA,
      input({ products: [{ productGid: productGid(1), variantGids: [variantGid(101)] }] }),
    );
    expect(subset.products[0].variants.map((v) => v.variantGid)).toEqual([variantGid(101)]);

    const all = await createDraftCampaign(
      shopA,
      input({ products: [{ productGid: productGid(2), variantGids: [variantGid(201)] }] }),
    );
    expect(all.products[0].variants).toEqual([]);
  });

  it("rejects products that don't exist in the shop", async () => {
    const error = await createDraftCampaign(
      shopA,
      input({ products: [{ productGid: productGid(999), variantGids: [] }] }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toHaveProperty("products.0");
    expect(await prisma.campaign.count()).toBe(0);
  });

  it("rejects variants that belong to a different product", async () => {
    const error = await createDraftCampaign(
      shopA,
      input({ products: [{ productGid: productGid(1), variantGids: [variantGid(201)] }] }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
  });

  it("rejects invalid input before calling Shopify", async () => {
    const { client, calls } = createAdminDouble(catalog);
    const error = await createDraftCampaign({ ...shopA, admin: client }, input({ tiers: [] })).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });
});

describe("tenant isolation", () => {
  it("never exposes or mutates another shop's campaign", async () => {
    const campaign = await createDraftCampaign(shopA, input());

    await expect(getCampaign(shopB.shopId, campaign.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCampaign(shopB, campaign.id, input({ name: "Hijacked" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeCampaignStatus(shopB, campaign.id, "ARCHIVED")).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCampaign(shopB, campaign.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listCampaigns(shopB.shopId)).toHaveLength(0);

    const unchanged = await getCampaign(shopA.shopId, campaign.id);
    expect(unchanged.name).toBe("Bulk socks");
    expect(unchanged.status).toBe("DRAFT");
  });

  it("does not report overlap with another shop's active campaign", async () => {
    const a = await createDraftCampaign(shopA, input());
    const b = await createDraftCampaign(shopB, input());
    await changeCampaignStatus(shopA, a.id, "ACTIVE");
    await expect(changeCampaignStatus(shopB, b.id, "ACTIVE")).resolves.toMatchObject({ status: "ACTIVE" });
  });
});

describe("updateCampaign", () => {
  it("replaces targets and tiers atomically", async () => {
    const campaign = await createDraftCampaign(shopA, input());
    const updated = await updateCampaign(
      shopA,
      campaign.id,
      input({
        name: "Renamed",
        discountType: "FIXED_AMOUNT",
        products: [{ productGid: productGid(3), variantGids: [] }],
        tiers: [{ minQuantity: 3, value: "2" }],
      }),
    );
    expect(updated.name).toBe("Renamed");
    expect(updated.discountType).toBe("FIXED_AMOUNT");
    expect(updated.products.map((p) => p.productGid)).toEqual([productGid(3)]);
    expect(updated.tiers.map((t) => t.value.toString())).toEqual(["2"]);
    expect(await prisma.campaignProduct.count()).toBe(1);
    expect(await prisma.quantityTier.count()).toBe(1);
  });

  it("leaves the campaign untouched when validation fails", async () => {
    const campaign = await createDraftCampaign(shopA, input());
    await expect(updateCampaign(shopA, campaign.id, input({ name: "" }))).rejects.toBeInstanceOf(ValidationError);
    expect((await getCampaign(shopA.shopId, campaign.id)).name).toBe("Bulk socks");
  });

  it("refuses to edit archived campaigns", async () => {
    const campaign = await createDraftCampaign(shopA, input());
    await changeCampaignStatus(shopA, campaign.id, "ARCHIVED");
    await expect(updateCampaign(shopA, campaign.id, input())).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("changeCampaignStatus", () => {
  it("walks the lifecycle and records each transition", async () => {
    const campaign = await createDraftCampaign(shopA, input());
    await changeCampaignStatus(shopA, campaign.id, "ACTIVE");
    await changeCampaignStatus(shopA, campaign.id, "PAUSED");
    await changeCampaignStatus(shopA, campaign.id, "ARCHIVED");

    const archived = await getCampaign(shopA.shopId, campaign.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).toBeInstanceOf(Date);

    await changeCampaignStatus(shopA, campaign.id, "DRAFT");
    expect((await getCampaign(shopA.shopId, campaign.id)).archivedAt).toBeNull();

    const transitions = await prisma.auditLog.findMany({
      where: { action: "campaign.status_changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(transitions.map((t) => (t.metadata as { to: string }).to)).toEqual([
      "ACTIVE",
      "PAUSED",
      "ARCHIVED",
      "DRAFT",
    ]);
  });

  it("rejects invalid transitions", async () => {
    const campaign = await createDraftCampaign(shopA, input());
    await expect(changeCampaignStatus(shopA, campaign.id, "PAUSED")).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks activating a campaign that overlaps an active one", async () => {
    const first = await createDraftCampaign(shopA, input());
    const second = await createDraftCampaign(
      shopA,
      input({ name: "Overlap", products: [{ productGid: productGid(1), variantGids: [variantGid(102)] }] }),
    );
    await changeCampaignStatus(shopA, first.id, "ACTIVE");

    const error = await changeCampaignStatus(shopA, second.id, "ACTIVE").catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain("Bulk socks");
    expect((await getCampaign(shopA.shopId, second.id)).status).toBe("DRAFT");
  });

  it("allows activating campaigns on disjoint variants of the same product", async () => {
    const first = await createDraftCampaign(
      shopA,
      input({ products: [{ productGid: productGid(1), variantGids: [variantGid(101)] }] }),
    );
    const second = await createDraftCampaign(
      shopA,
      input({ name: "Other variant", products: [{ productGid: productGid(1), variantGids: [variantGid(102)] }] }),
    );
    await changeCampaignStatus(shopA, first.id, "ACTIVE");
    await expect(changeCampaignStatus(shopA, second.id, "ACTIVE")).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("serialises concurrent activations so only one overlapping campaign wins", async () => {
    const first = await createDraftCampaign(shopA, input());
    const second = await createDraftCampaign(shopA, input({ name: "Twin" }));
    const results = await Promise.allSettled([
      changeCampaignStatus(shopA, first.id, "ACTIVE"),
      changeCampaignStatus(shopA, second.id, "ACTIVE"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.campaign.count({ where: { status: "ACTIVE" } })).toBe(1);
  });

  it("blocks editing an active campaign into an overlap", async () => {
    const first = await createDraftCampaign(shopA, input());
    const second = await createDraftCampaign(
      shopA,
      input({ name: "Second", products: [{ productGid: productGid(2), variantGids: [] }] }),
    );
    await changeCampaignStatus(shopA, first.id, "ACTIVE");
    await changeCampaignStatus(shopA, second.id, "ACTIVE");
    await expect(
      updateCampaign(shopA, second.id, input({ name: "Second" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("deleteCampaign", () => {
  it("deletes drafts with their children", async () => {
    const campaign = await createDraftCampaign(shopA, input());
    await deleteCampaign(shopA, campaign.id);
    expect(await prisma.campaign.count()).toBe(0);
    expect(await prisma.campaignProduct.count()).toBe(0);
    expect(await prisma.quantityTier.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "campaign.deleted" } })).toBe(1);
  });

  it("refuses to delete active campaigns", async () => {
    const campaign = await createDraftCampaign(shopA, input());
    await changeCampaignStatus(shopA, campaign.id, "ACTIVE");
    await expect(deleteCampaign(shopA, campaign.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("listCampaigns", () => {
  it("hides archived campaigns unless filtered for", async () => {
    const a = await createDraftCampaign(shopA, input());
    await createDraftCampaign(shopA, input({ name: "Kept" }));
    await changeCampaignStatus(shopA, a.id, "ARCHIVED");
    expect((await listCampaigns(shopA.shopId)).map((c) => c.name)).toEqual(["Kept"]);
    expect(await listCampaigns(shopA.shopId, { status: "ARCHIVED" })).toHaveLength(1);
  });
});
