import type { CampaignStatusValue, DiscountTypeValue } from "./campaign-validation";

export const STATUS_LABEL: Record<CampaignStatusValue, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};

export const STATUS_TONE = {
  DRAFT: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "neutral",
} as const satisfies Record<CampaignStatusValue, string>;

export function formatMoney(amount: string | number, currencyCode?: string | null) {
  const value = Number(amount);
  if (!currencyCode) return value.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currencyCode}`;
  }
}

export function formatDiscount(
  type: DiscountTypeValue,
  value: string | number,
  currencyCode?: string | null,
) {
  if (type === "PERCENTAGE") return `${Number(value).toString()}% off`;
  return `${formatMoney(value, currencyCode)} off each`;
}

export function formatTierSummary(
  type: DiscountTypeValue,
  tiers: { minQuantity: number; value: string | number }[],
  currencyCode?: string | null,
) {
  if (!tiers.length) return "No tiers";
  return tiers
    .map((t) => `${t.minQuantity}+: ${formatDiscount(type, t.value, currencyCode)}`)
    .join(" · ");
}

export function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const AUDIT_LABELS: Record<string, string> = {
  "campaign.created": "Campaign created",
  "campaign.updated": "Campaign updated",
  "campaign.status_changed": "Campaign status changed",
  "campaign.deleted": "Campaign deleted",
  "widget_settings.updated": "Widget appearance updated",
  "shop_settings.updated": "Settings updated",
};

export function auditLabel(action: string) {
  return AUDIT_LABELS[action] ?? action;
}
