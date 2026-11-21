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
