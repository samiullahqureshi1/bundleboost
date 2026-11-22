import { z } from "zod";

/**
 * Campaign input contract shared by the server (authoritative) and the
 * client (instant feedback). The server re-validates every submission.
 */

export const CAMPAIGN_LIMITS = {
  nameMax: 100,
  labelMax: 60,
  maxProducts: 100,
  maxVariantsPerProduct: 250,
  // Highest plan's allowance; each plan sets its own lower limit.
  maxTiers: 20,
  maxQuantity: 10_000,
  maxFixedAmount: 1_000_000,
  // Subscription orders a discount can cover (0 = every order).
  maxRecurringCycles: 100,
} as const;

export const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;
export type DiscountTypeValue = (typeof DISCOUNT_TYPES)[number];

export const PURCHASE_TYPES = ["ONE_TIME", "SUBSCRIPTION", "BOTH"] as const;
export type PurchaseTypeValue = (typeof PURCHASE_TYPES)[number];

/** Lowest tier quantity: 1 for subscription-only campaigns, otherwise 2. */
export const minTierQuantity = (purchaseType: PurchaseTypeValue) => (purchaseType === "SUBSCRIPTION" ? 1 : 2);

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;

const tierSchema = z.object({
  minQuantity: z.coerce
    .number({ error: "Enter a quantity" })
    .int("Quantity must be a whole number")
    // 1 is only allowed for subscription-only campaigns (checked below).
    .min(1, "Quantity must be at least 1")
    .max(CAMPAIGN_LIMITS.maxQuantity, `Quantity must be ${CAMPAIGN_LIMITS.maxQuantity} or less`),
  value: z
    .string({ error: "Enter a discount value" })
    .trim()
    .regex(TWO_DECIMALS, "Use a number with at most 2 decimal places"),
  label: z
    .string()
    .trim()
    .max(CAMPAIGN_LIMITS.labelMax, `Label must be ${CAMPAIGN_LIMITS.labelMax} characters or less`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const productSchema = z.object({
  productGid: z.string().regex(PRODUCT_GID, "Invalid product"),
  variantGids: z
    .array(z.string().regex(VARIANT_GID, "Invalid variant"))
    .max(CAMPAIGN_LIMITS.maxVariantsPerProduct)
    .default([]),
});

const optionalDate = z
  .union([z.literal(""), z.null(), z.undefined(), z.coerce.date()])
  .transform((v) => (v instanceof Date ? v : undefined))
  .refine((v) => v === undefined || !Number.isNaN(v.getTime()), "Invalid date");

export const campaignInputSchema = z
  .object({
    name: z
      .string({ error: "Enter a campaign name" })
      .trim()
      .min(1, "Enter a campaign name")
      .max(CAMPAIGN_LIMITS.nameMax, `Name must be ${CAMPAIGN_LIMITS.nameMax} characters or less`),
    discountType: z.enum(DISCOUNT_TYPES, { error: "Choose a discount type" }),
    discountLabel: z
      .string()
      .trim()
      .max(CAMPAIGN_LIMITS.labelMax, `Label must be ${CAMPAIGN_LIMITS.labelMax} characters or less`)
      .optional()
      .transform((v) => (v ? v : undefined)),
    products: z
      .array(productSchema)
      .min(1, "Select at least one product")
      .max(CAMPAIGN_LIMITS.maxProducts, `Select ${CAMPAIGN_LIMITS.maxProducts} products or fewer`),
    tiers: z
      .array(tierSchema)
      .min(1, "Add at least one quantity tier")
      .max(CAMPAIGN_LIMITS.maxTiers, `Use ${CAMPAIGN_LIMITS.maxTiers} tiers or fewer`),
    // Optional so older clients keep Shopify's defaults (both, first order).
    purchaseType: z.enum(PURCHASE_TYPES, { error: "Choose which purchases get the discount" }).default("BOTH"),
    recurringCycleLimit: z.coerce
      .number({ error: "Enter a number of orders" })
      .int("Use a whole number")
      .min(0, "Use 0 or more")
      .max(
        CAMPAIGN_LIMITS.maxRecurringCycles,
        `Use ${CAMPAIGN_LIMITS.maxRecurringCycles} orders or fewer, or choose every order`,
      )
      .default(1),
    startsAt: optionalDate.optional(),
    endsAt: optionalDate.optional(),
  })
  .superRefine((input, ctx) => {
    // "Buy 1" is a plain discount, which only makes sense as a subscriber
    // perk; quantity breaks for everyone start at 2.
    if (input.purchaseType !== "SUBSCRIPTION") {
      input.tiers.forEach((tier, i) => {
        if (tier.minQuantity < 2) {
          ctx.addIssue({
            code: "custom",
            path: ["tiers", i, "minQuantity"],
            message: "Quantity must be at least 2. Quantity 1 is allowed when the campaign applies to subscriptions only.",
          });
        }
      });
    }

    // Per-tier value bounds depend on the discount type.
    input.tiers.forEach((tier, i) => {
      const value = Number(tier.value);
      if (!(value > 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "value"],
          message: "Discount must be greater than 0",
        });
      } else if (input.discountType === "PERCENTAGE" && value > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "value"],
          message: "Percentage cannot exceed 100",
        });
      } else if (
        input.discountType === "FIXED_AMOUNT" &&
        value > CAMPAIGN_LIMITS.maxFixedAmount
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "value"],
          message: "Amount is too large",
        });
      }
    });

    // Tiers must be listed in ascending quantity order with no duplicates,
    // and a larger quantity must never give a smaller discount.
    for (let i = 1; i < input.tiers.length; i++) {
      const prev = input.tiers[i - 1];
      const curr = input.tiers[i];
      if (curr.minQuantity <= prev.minQuantity) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "minQuantity"],
          message: "Each tier needs a higher quantity than the one above it",
        });
      } else if (Number(curr.value) < Number(prev.value)) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "value"],
          message: "Higher quantities can't have a smaller discount",
        });
      }
    }

    const seen = new Set<string>();
    input.products.forEach((product, i) => {
      if (seen.has(product.productGid)) {
        ctx.addIssue({
          code: "custom",
          path: ["products", i],
          message: "Product is selected more than once",
        });
      }
      seen.add(product.productGid);
    });

    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End date must be after the start date",
      });
    }
  });

export type CampaignInput = z.output<typeof campaignInputSchema>;
export type CampaignFormValues = z.input<typeof campaignInputSchema>;

export type ValidationResult =
  | { success: true; data: CampaignInput }
  | { success: false; fieldErrors: Record<string, string> };

/**
 * Validates raw input and flattens issues into `path.to.field` → message,
 * keeping only the first message per field.
 */
export function validateCampaignInput(raw: unknown): ValidationResult {
  const result = campaignInputSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    fieldErrors[key] ??= issue.message;
  }
  return { success: false, fieldErrors };
}

// ---------------------------------------------------------------------------
// Status lifecycle
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type CampaignStatusValue = (typeof CAMPAIGN_STATUSES)[number];

const TRANSITIONS: Record<CampaignStatusValue, readonly CampaignStatusValue[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export function allowedTransitions(from: CampaignStatusValue) {
  return TRANSITIONS[from];
}

export function canTransition(from: CampaignStatusValue, to: CampaignStatusValue) {
  return TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Overlap detection (pure, used by the service before activation)
// ---------------------------------------------------------------------------

export type TargetSet = { productGid: string; variantGids: string[] }[];

/**
 * Two targets overlap when they share a product and either side targets all
 * variants of it or their explicit variant lists intersect.
 */
export function findOverlappingProducts(a: TargetSet, b: TargetSet): string[] {
  const byProduct = new Map(b.map((t) => [t.productGid, t.variantGids]));
  const overlaps: string[] = [];
  for (const target of a) {
    const other = byProduct.get(target.productGid);
    if (!other) continue;
    if (
      target.variantGids.length === 0 ||
      other.length === 0 ||
      target.variantGids.some((v) => other.includes(v))
    ) {
      overlaps.push(target.productGid);
    }
  }
  return overlaps;
}
