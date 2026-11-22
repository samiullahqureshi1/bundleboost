import prisma from "../../db.server";
import {
  flattenIssues,
  shopSettingsSchema,
  widgetSettingsSchema,
} from "../../lib/settings-validation";
import { ValidationError } from "../errors";
import { planFor, sameSetting, WIDGET_DEFAULTS, type Plan, type WidgetField } from "../../lib/plans";
import { recordAudit } from "./audit.service";

type Actor = { shopId: string; actorId: string | null };

export async function getWidgetSettings(shopId: string) {
  return prisma.widgetSettings.upsert({
    where: { shopId },
    create: { shopId },
    update: {},
  });
}

/**
 * Saves widget settings. With a plan, fields the plan doesn't include can only
 * keep their stored value or go back to the default (the storefront shows
 * defaults for them anyway).
 */
export async function updateWidgetSettings(ctx: Actor & { plan?: Plan }, raw: unknown) {
  const parsed = widgetSettingsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(flattenIssues(parsed.error));
  if (ctx.plan) {
    const plan = ctx.plan;
    const current = await getWidgetSettings(ctx.shopId);
    const locked: Record<string, string> = {};
    for (const field of Object.keys(parsed.data) as WidgetField[]) {
      if (plan.widget.includes(field)) continue;
      const value = parsed.data[field];
      // Unchanged, or reset to the default, is always allowed.
      if (!sameSetting(value, current[field]) && !sameSetting(value, WIDGET_DEFAULTS[field])) {
        const next = planFor((p) => p.widget.includes(field));
        locked[field] = `Not included in the ${plan.name} plan.${next ? ` Upgrade to ${next.name} to change it.` : ""}`;
      }
    }
    if (Object.keys(locked).length) {
      throw new ValidationError(locked, "Some of these settings need a higher plan.");
    }
  }
  return prisma.$transaction(async (tx) => {
    const settings = await tx.widgetSettings.upsert({
      where: { shopId: ctx.shopId },
      create: { shopId: ctx.shopId, ...parsed.data },
      update: parsed.data,
    });
    await recordAudit(
      {
        shopId: ctx.shopId,
        actorId: ctx.actorId,
        action: "widget_settings.updated",
        entityType: "WidgetSettings",
        entityId: settings.id,
      },
      tx,
    );
    return settings;
  });
}

export async function getShopSettings(shopId: string) {
  return prisma.shopSettings.upsert({
    where: { shopId },
    create: { shopId },
    update: {},
  });
}

export async function updateShopSettings(ctx: Actor, raw: unknown) {
  const parsed = shopSettingsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(flattenIssues(parsed.error));
  return prisma.$transaction(async (tx) => {
    const settings = await tx.shopSettings.upsert({
      where: { shopId: ctx.shopId },
      create: { shopId: ctx.shopId, ...parsed.data },
      update: parsed.data,
    });
    await recordAudit(
      {
        shopId: ctx.shopId,
        actorId: ctx.actorId,
        action: "shop_settings.updated",
        entityType: "ShopSettings",
        entityId: settings.id,
      },
      tx,
    );
    return settings;
  });
}
