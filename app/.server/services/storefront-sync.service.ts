import prisma from "../../db.server";
import { AppError } from "../errors";
import { logger } from "../logger";
import { setStorefrontConfig } from "../shopify/app-metafields";
import { applyWidgetPlan } from "../../lib/plans";
import { cachedPlan } from "./billing.service";
import type { AdminGraphqlClient } from "../shopify/graphql";

/**
 * Publishes what the storefront widget needs — ACTIVE campaigns' tiers per
 * product plus widget appearance — to an app-data metafield read by the
 * theme app extension (extensions/bundleboost-widget). Only ACTIVE campaigns
 * are published, so the widget never advertises a discount that checkout
 * won't apply.
 */

const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

export type StorefrontConfig = {
  v: 1;
  currency: string | null;
  widget: {
    heading: string;
    layout: "stacked" | "grid";
    accent_color: string;
    text_color: string;
    background_color: string;
    border_radius: number;
    show_savings: boolean;
    highlight_best_deal: boolean;
  };
  products: Record<
    string,
    {
      type: "percentage" | "fixed";
      variants: string[];
      tiers: { qty: number; value: number; label: string }[];
    }[]
  >;
};

export async function buildStorefrontConfig(shopId: string): Promise<StorefrontConfig> {
  const [shop, widget, campaigns] = await Promise.all([
    prisma.shop.findUniqueOrThrow({ where: { id: shopId } }),
    prisma.widgetSettings
      .upsert({ where: { shopId }, create: { shopId }, update: {} })
      // Settings the plan doesn't include are published as defaults.
      .then(async (w) => applyWidgetPlan(w, await cachedPlan(shopId))),
    prisma.campaign.findMany({
      where: { shopId, status: "ACTIVE", syncStatus: "SYNCED" },
      orderBy: { createdAt: "asc" },
      include: {
        products: { include: { variants: true } },
        tiers: { orderBy: { position: "asc" } },
      },
    }),
  ]);

  const products: StorefrontConfig["products"] = {};
  for (const campaign of campaigns) {
    const tiers = campaign.tiers.map((t) => ({
      qty: t.minQuantity,
      value: Number(t.value),
      label: t.label ?? "",
    }));
    for (const product of campaign.products) {
      const key = numericId(product.productGid);
      (products[key] ??= []).push({
        type: campaign.discountType === "PERCENTAGE" ? "percentage" : "fixed",
        variants: product.variants.map((v) => numericId(v.variantGid)),
        tiers,
      });
    }
  }

  return {
    v: 1,
    currency: shop.currencyCode,
    widget: {
      heading: widget.heading,
      layout: widget.layout === "GRID" ? "grid" : "stacked",
      accent_color: widget.accentColor,
      text_color: widget.textColor,
      background_color: widget.backgroundColor,
      border_radius: widget.borderRadius,
      show_savings: widget.showSavings,
      highlight_best_deal: widget.highlightBestDeal,
    },
    products,
  };
}

export async function syncStorefrontConfig(
  admin: AdminGraphqlClient,
  shopId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const config = await buildStorefrontConfig(shopId);
    await setStorefrontConfig(admin, JSON.stringify(config));
    await prisma.shop.update({
      where: { id: shopId },
      data: { storefrontSyncedAt: new Date() },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.error("Storefront sync failed", { shopId, error });
    return {
      ok: false,
      error: error instanceof AppError ? error.message : "Shopify couldn't be reached.",
    };
  }
}
