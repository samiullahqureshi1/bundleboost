import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const color = z.string().trim().regex(HEX_COLOR, "Use a 6-digit hex colour, e.g. #008060");

/** Booleans arrive from forms as "true"/"false"/"on" strings or real booleans. */
const formBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "on", ""])])
  .transform((v) => v === true || v === "true" || v === "on");

export const widgetSettingsSchema = z.object({
  heading: z
    .string()
    .trim()
    .min(1, "Enter a heading")
    .max(80, "Heading must be 80 characters or less"),
  layout: z.enum(["STACKED", "GRID"], { error: "Choose a layout" }),
  accentColor: color,
  textColor: color,
  backgroundColor: color,
  borderRadius: z.coerce
    .number()
    .int("Use a whole number")
    .min(0, "Must be 0 or more")
    .max(32, "Must be 32 or less"),
  showSavings: formBoolean,
  highlightBestDeal: formBoolean,
  subheading: z.string().trim().max(120, "Sub-heading must be 120 characters or less"),
  buyLabel: z
    .string()
    .trim()
    .min(1, "Enter the tier text")
    .max(40, "Tier text must be 40 characters or less")
    .refine((v) => v.includes("{quantity}"), "Include {quantity} where the number goes"),
  badgeText: z.string().trim().min(1, "Enter the badge text").max(20, "Badge text must be 20 characters or less"),
  spacing: z.enum(["COMPACT", "COMFORTABLE", "SPACIOUS"], { error: "Choose a spacing" }),
  headingSize: z.coerce.number().int("Use a whole number").min(12, "Must be 12 or more").max(32, "Must be 32 or less"),
  textSize: z.coerce.number().int("Use a whole number").min(11, "Must be 11 or more").max(20, "Must be 20 or less"),
  tierBorderColor: color,
  selectedBackgroundColor: color,
  savingsColor: color,
  badgeColor: color,
  badgeTextColor: color,
  containerBorderColor: color,
  showPricePerItem: formBoolean,
  showContainerBorder: formBoolean,
  showPurchaseOptions: formBoolean,
  oneTimeLabel: z
    .string()
    .trim()
    .min(1, "Enter a label")
    .max(40, "Label must be 40 characters or less"),
  subscribeLabel: z
    .string()
    .trim()
    .min(1, "Enter a label")
    .max(50, "Label must be 50 characters or less"),
  frequencyLabel: z
    .string()
    .trim()
    .min(1, "Enter a label")
    .max(40, "Label must be 40 characters or less"),
  // Selling plan id -> display name and/or hidden. Entries that change
  // nothing are dropped so the stored value stays small.
  planOverrides: z
    .record(
      z.string().regex(/^\d+$/, "Invalid plan"),
      z.object({
        label: z.string().trim().max(60, "Name must be 60 characters or less").optional(),
        hidden: z.boolean().optional(),
      }),
    )
    .refine((v) => Object.keys(v).length <= 200, "Too many plans")
    .default({})
    .transform((v) =>
      Object.fromEntries(
        Object.entries(v)
          .map(([id, o]) => [id, { ...(o.label ? { label: o.label } : {}), ...(o.hidden ? { hidden: true } : {}) }] as const)
          .filter(([, o]) => Object.keys(o).length > 0),
      ),
    ),
});

export type WidgetSettingsInput = z.output<typeof widgetSettingsSchema>;

export const shopSettingsSchema = z.object({
  defaultDiscountLabel: z
    .string()
    .trim()
    .min(1, "Enter a label")
    .max(60, "Label must be 60 characters or less"),
  combineWithProductDiscounts: formBoolean,
  combineWithOrderDiscounts: formBoolean,
  combineWithShippingDiscounts: formBoolean,
});

export type ShopSettingsInput = z.output<typeof shopSettingsSchema>;

export function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    out[key] ??= issue.message;
  }
  return out;
}
