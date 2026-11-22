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
    subheading: string;
    buy_label: string;
    badge_text: string;
    spacing: "compact" | "comfortable" | "spacious";
    heading_size: number;
    text_size: number;
    tier_border_color: string;
    selected_background_color: string;
    savings_color: string;
    badge_color: string;
    badge_text_color: string;
    container_border_color: string;
    show_price_per_item: boolean;
    show_container_border: boolean;
    show_purchase_options: boolean;
    one_time_label: string;
    subscribe_label: string;
    frequency_label: string;
    /** Selling plan id -> { label?, hidden? } set by the merchant. */
    plan_overrides: Record<string, { label?: string; hidden?: boolean }>;
  };
  products: Record<
    string,
    {
      type: "percentage" | "fixed";
      /** Which purchases the offer is for: the widget shows it only for those. */
      purchase: "one_time" | "subscription" | "both";
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
        purchase:
          campaign.purchaseType === "SUBSCRIPTION"
            ? "subscription"
            : campaign.purchaseType === "ONE_TIME"
              ? "one_time"
              : "both",
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
      subheading: widget.subheading,
      buy_label: widget.buyLabel,
      badge_text: widget.badgeText,
      spacing: widget.spacing.toLowerCase() as StorefrontConfig["widget"]["spacing"],
      heading_size: widget.headingSize,
      text_size: widget.textSize,
      tier_border_color: widget.tierBorderColor,
      selected_background_color: widget.selectedBackgroundColor,
      savings_color: widget.savingsColor,
      badge_color: widget.badgeColor,
      badge_text_color: widget.badgeTextColor,
      container_border_color: widget.containerBorderColor,
      show_price_per_item: widget.showPricePerItem,
      show_container_border: widget.showContainerBorder,
      show_purchase_options: widget.showPurchaseOptions,
      one_time_label: widget.oneTimeLabel,
      subscribe_label: widget.subscribeLabel,
      frequency_label: widget.frequencyLabel,
      plan_overrides: (widget.planOverrides ?? {}) as Record<string, { label?: string; hidden?: boolean }>,
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
