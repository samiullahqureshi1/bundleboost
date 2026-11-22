import { z } from "zod";

/**
 * Subscription plans BundleBoost creates (Shopify selling plan groups):
 * input contract shared by the server (authoritative) and the editor.
 */

export const FREQUENCY_INTERVALS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type FrequencyIntervalValue = (typeof FREQUENCY_INTERVALS)[number];

export const SUBSCRIPTION_LIMITS = {
  nameMax: 60,
  labelMax: 40,
  maxFrequencies: 10,
  maxProducts: 100,
  // Largest "every N" per unit (e.g. every 52 weeks).
  maxCount: { DAY: 365, WEEK: 52, MONTH: 24, YEAR: 5 } as Record<FrequencyIntervalValue, number>,
} as const;

const UNIT: Record<FrequencyIntervalValue, [string, string]> = {
  DAY: ["day", "days"],
  WEEK: ["week", "weeks"],
  MONTH: ["month", "months"],
  YEAR: ["year", "years"],
};

/** "3 months", "1 week" — the option value Shopify stores per plan. */
export function frequencyOption(interval: FrequencyIntervalValue, count: number) {
  return `${count} ${UNIT[interval][count === 1 ? 0 : 1]}`;
}

/** "Delivery every 3 months", "Delivery every week" — default plan name. */
export function frequencyName(interval: FrequencyIntervalValue, count: number) {
  return count === 1 ? `Delivery every ${UNIT[interval][0]}` : `Delivery every ${count} ${UNIT[interval][1]}`;
}

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

const frequencySchema = z.object({
  interval: z.enum(FREQUENCY_INTERVALS, { error: "Choose days, weeks, months or years" }),
  intervalCount: z.coerce
    .number({ error: "Enter a number" })
    .int("Use a whole number")
    .min(1, "Use 1 or more"),
  discountPercent: z.coerce
    .number({ error: "Enter a discount" })
    .min(0, "Use 0 or more")
    .max(100, "Use 100 or less")
    .refine((v) => Number.isInteger(v * 100), "Use at most 2 decimal places"),
  label: z
    .string()
    .trim()
    .max(SUBSCRIPTION_LIMITS.labelMax, `Name must be ${SUBSCRIPTION_LIMITS.labelMax} characters or less`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const subscriptionPlanSchema = z
  .object({
    name: z
      .string({ error: "Enter a name" })
      .trim()
      .min(1, "Enter a name")
      .max(SUBSCRIPTION_LIMITS.nameMax, `Name must be ${SUBSCRIPTION_LIMITS.nameMax} characters or less`),
    optionName: z.string().trim().min(1, "Enter a label").max(40, "Label must be 40 characters or less").default("Delivery every"),
    frequencies: z
      .array(frequencySchema)
      .min(1, "Add at least one frequency")
      .max(SUBSCRIPTION_LIMITS.maxFrequencies, `Use ${SUBSCRIPTION_LIMITS.maxFrequencies} frequencies or fewer`),
    productGids: z
      .array(z.string().regex(PRODUCT_GID, "Invalid product"))
      .min(1, "Select at least one product")
      .max(SUBSCRIPTION_LIMITS.maxProducts, `Select ${SUBSCRIPTION_LIMITS.maxProducts} products or fewer`),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.frequencies.forEach((f, i) => {
      const max = SUBSCRIPTION_LIMITS.maxCount[f.interval];
      if (f.intervalCount > max) {
        ctx.addIssue({ code: "custom", path: ["frequencies", i, "intervalCount"], message: `Use ${max} or less` });
      }
      const key = `${f.interval}:${f.intervalCount}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["frequencies", i, "intervalCount"], message: "This frequency is already in the plan" });
      }
      seen.add(key);
    });
    if (new Set(input.productGids).size !== input.productGids.length) {
      ctx.addIssue({ code: "custom", path: ["productGids"], message: "A product is selected more than once" });
    }
  });

export type SubscriptionPlanInput = z.output<typeof subscriptionPlanSchema>;
export type SubscriptionPlanFormValues = z.input<typeof subscriptionPlanSchema>;

export function validateSubscriptionPlan(raw: unknown):
  | { success: true; data: SubscriptionPlanInput }
  | { success: false; fieldErrors: Record<string, string> } {
  const result = subscriptionPlanSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    fieldErrors[issue.path.length ? issue.path.join(".") : "form"] ??= issue.message;
  }
  return { success: false, fieldErrors };
}
