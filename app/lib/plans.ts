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
  | "highlightBestDeal";

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

const BASIC_WIDGET: WidgetField[] = ["heading"];
const CUSTOM_WIDGET: WidgetField[] = [...BASIC_WIDGET, "layout", "accentColor", "showSavings", "highlightBestDeal"];
const FULL_WIDGET: WidgetField[] = [...CUSTOM_WIDGET, "textColor", "backgroundColor", "borderRadius"];

export const PLANS: Record<PlanHandle, Plan> = {
  free: {
    handle: "free",
    name: "Free",
    price: 0,
    tagline: "For new stores",
    activeCampaigns: 1,
    liveProducts: 5,
    tiersPerCampaign: 3,
    widget: BASIC_WIDGET,
    features: [
      "1 active campaign",
      "Up to 5 products",
      "3 discount tiers",
      "Percentage & fixed discounts",
      "Basic widget",
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
    widget: CUSTOM_WIDGET,
    features: [
      "10 active campaigns",
      "Up to 100 products",
      "Up to 10 discount tiers",
      "Percentage & fixed discounts",
      "Customizable widget",
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
      "Full widget customization",
      "Percentage & fixed discounts",
      "Priority support",
    ],
  },
};

export const PLAN_ORDER: PlanHandle[] = ["free", "growth", "pro"];

export const PLAN_FOOTNOTES = [
  "* Shopify allows up to 25 active discount functions per store, shared with any other discount apps you use.",
  "* Each campaign can target up to 100 products. Unlimited means no limit on products across your campaigns.",
];

export function planFromHandle(handle: string | null | undefined): Plan {
  return PLANS[(handle ?? "") as PlanHandle] ?? PLANS.free;
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
} as const;

/** Widget settings as the plan allows them: locked fields fall back to defaults. */
export function applyWidgetPlan<T extends Record<WidgetField, unknown>>(settings: T, plan: Plan): T {
  const out = { ...settings };
  for (const field of Object.keys(WIDGET_DEFAULTS) as WidgetField[]) {
    if (!plan.widget.includes(field)) (out as Record<WidgetField, unknown>)[field] = WIDGET_DEFAULTS[field];
  }
  return out;
}
