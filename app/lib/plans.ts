/**
 * BundleBoost plans. Prices and the plans themselves live in Shopify App
 * Pricing (Partner Dashboard); this file only maps each plan handle to what
 * it unlocks. The handles must match the plan handles configured there.
 */

export type PlanHandle = "free" | "growth" | "pro";

/** Which widget settings a plan may change. Locked ones use the defaults. */
export type WidgetField =
  | "heading"
  | "layout"
  | "accentColor"
  | "textColor"
  | "backgroundColor"
  | "borderRadius"
  | "showSavings"
  | "highlightBestDeal"
  | "subheading"
  | "buyLabel"
  | "badgeText"
  | "spacing"
  | "headingSize"
  | "textSize"
  | "tierBorderColor"
  | "selectedBackgroundColor"
  | "savingsColor"
  | "badgeColor"
  | "badgeTextColor"
  | "containerBorderColor"
  | "showPricePerItem"
  | "showContainerBorder"
  | "showPurchaseOptions"
  | "oneTimeLabel"
  | "subscribeLabel"
  | "frequencyLabel"
  | "planOverrides";

export type Plan = {
  handle: PlanHandle;
  name: string;
  /** Monthly price in USD, as configured in Shopify App Pricing. */
  price: number;
  tagline: string;
  badge?: string;
  /** null = no plan limit (technical limits still apply). */
  activeCampaigns: number;
  liveProducts: number | null;
  tiersPerCampaign: number;
  widget: WidgetField[];
  features: string[];
};

// Widget options by plan. Each plan includes everything from the one below.
// Free: the essentials (text, layout, what to show, brand colour).
const FREE_WIDGET: WidgetField[] = [
  "heading",
  "subheading",
  "layout",
  "showSavings",
  "highlightBestDeal",
  "accentColor",
  "showPurchaseOptions",
];

// Growth: labels, spacing and shape, and the main colours (presets).
const GROWTH_WIDGET: WidgetField[] = [
  ...FREE_WIDGET,
  "buyLabel",
  "badgeText",
  "showPricePerItem",
  "showContainerBorder",
  "spacing",
  "borderRadius",
  "textColor",
  "backgroundColor",
  "oneTimeLabel",
  "subscribeLabel",
  "frequencyLabel",
  "planOverrides",
];

// Pro: everything, including font sizes and every individual colour.
const FULL_WIDGET: WidgetField[] = [
  ...GROWTH_WIDGET,
  "headingSize",
  "textSize",
  "tierBorderColor",
  "selectedBackgroundColor",
  "savingsColor",
  "badgeColor",
  "badgeTextColor",
  "containerBorderColor",
];

export const PLANS: Record<PlanHandle, Plan> = {
  free: {
    handle: "free",
    name: "Free",
    price: 0,
    tagline: "For new stores",
    activeCampaigns: 1,
    liveProducts: 5,
    tiersPerCampaign: 3,
    widget: FREE_WIDGET,
    features: [
      "1 active campaign",
      "Up to 5 products",
      "3 discount tiers",
      "Percentage & fixed discounts",
      "Basic widget: text, layout & brand colour",
    ],
  },
  growth: {
    handle: "growth",
    name: "Growth",
    price: 7.99,
    tagline: "For growing stores",
    activeCampaigns: 10,
    liveProducts: 100,
    tiersPerCampaign: 10,
    widget: GROWTH_WIDGET,
    features: [
      "10 active campaigns",
      "Up to 100 products",
      "Up to 10 discount tiers",
      "Percentage & fixed discounts",
      "Custom widget: labels, spacing, shape & colour presets",
      "Email support",
    ],
  },
  pro: {
    handle: "pro",
    name: "Pro",
    price: 14.99,
    tagline: "For established Shopify stores",
    badge: "Highest plan",
    activeCampaigns: 25,
    liveProducts: null,
    tiersPerCampaign: 20,
    widget: FULL_WIDGET,
    features: [
      "Up to 25 active campaigns*",
      "Unlimited product targeting*",
      "Up to 20 discount tiers",
      "Full widget customization: font sizes & every colour",
      "Percentage & fixed discounts",
      "Priority support",
    ],
  },
};

export const PLAN_NAMES: Record<PlanHandle, string> = {
  free: "Free",
  growth: "Growth",
  pro: "Pro",
};

export const PLAN_ORDER: PlanHandle[] = ["free", "growth", "pro"];

export const PLAN_FOOTNOTES = [
  "* Shopify allows up to 25 active discount functions per store, shared with any other discount apps you use.",
  "* Each campaign can target up to 100 products. Unlimited means no limit on products across your campaigns.",
];

export function planFromHandle(handle: string | null | undefined): Plan {
  if (!handle) return PLANS.free;
  const normalized = handle.toLowerCase().trim();
  if (normalized === "growth") return PLANS.growth;
  if (normalized === "pro") return PLANS.pro;
  if (normalized === "free") return PLANS.free;
  return PLANS[handle as PlanHandle] ?? PLANS.free;
}

/** The smallest plan that allows a value, for "Upgrade to …" prompts. */
export function planFor(check: (plan: Plan) => boolean): Plan | null {
  return PLAN_ORDER.map((h) => PLANS[h]).find(check) ?? null;
}

export const WIDGET_DEFAULTS = {
  heading: "Buy more, save more",
  layout: "STACKED",
  accentColor: "#008060",
  textColor: "#202223",
  backgroundColor: "#FFFFFF",
  borderRadius: 8,
  showSavings: true,
  highlightBestDeal: true,
  subheading: "",
  buyLabel: "Buy {quantity}+",
  badgeText: "Best deal",
  spacing: "COMFORTABLE",
  headingSize: 16,
  textSize: 14,
  tierBorderColor: "#DCDCE0",
  selectedBackgroundColor: "#FFFFFF",
  savingsColor: "#008060",
  badgeColor: "#008060",
  badgeTextColor: "#FFFFFF",
  containerBorderColor: "#E3E3E8",
  showPricePerItem: true,
  showContainerBorder: true,
  showPurchaseOptions: true,
  oneTimeLabel: "One-time purchase",
  subscribeLabel: "Subscribe & save {discount}",
  frequencyLabel: "Delivery frequency",
  planOverrides: {} as Record<string, { label?: string; hidden?: boolean }>,
} as const;

/** Compares setting values, including objects (plan overrides) and colours in any case. */
export function sameSetting(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : JSON.stringify(v ?? null));
  return norm(a) === norm(b);
}

/** Widget settings as the plan allows them: locked fields fall back to defaults. */
export function applyWidgetPlan<T extends Record<WidgetField, unknown>>(settings: T, plan: Plan): T {
  const out = { ...settings };
  for (const field of Object.keys(WIDGET_DEFAULTS) as WidgetField[]) {
    if (!plan.widget.includes(field)) (out as Record<WidgetField, unknown>)[field] = WIDGET_DEFAULTS[field];
  }
  return out;
}
