import type React from "react";
import {
  CAMPAIGN_LIMITS,
  type DiscountTypeValue,
} from "../lib/campaign-validation";
import { on } from "./bool-attrs";
import { EditorCard } from "./EditorCard";
import { NumberField, TextField } from "./Fields";

export type TierDraft = { minQuantity: string; value: string; label: string };

/** Quantity tiers as compact rows: buy · get · label · remove. */
export function TierEditor({
  num,
  tiers,
  discountType,
  currencyCode,
  onChange,
  errors,
  disabled,
  maxTiers = CAMPAIGN_LIMITS.maxTiers,
  limitNote,
  minQuantity = 2,
}: {
  num: string;
  tiers: TierDraft[];
  discountType: DiscountTypeValue;
  currencyCode: string | null;
  onChange: (tiers: TierDraft[]) => void;
  errors: Record<string, string>;
  disabled?: boolean;
  /** The shop's plan allowance (defaults to the absolute maximum). */
  maxTiers?: number;
  /** Shown when the limit is reached, e.g. an upgrade prompt. */
  limitNote?: React.ReactNode;
  /** Lowest allowed quantity (1 for subscription-only campaigns). */
  minQuantity?: number;
}) {
  const percent = discountType === "PERCENTAGE";
  const update = (index: number, patch: Partial<TierDraft>) =>
    onChange(tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const nextQty = last ? Number(last.minQuantity || 1) + 1 : minQuantity;
    onChange([
      ...tiers,
      { minQuantity: String(nextQty), value: "", label: "" },
    ]);
  };

  return (
    <EditorCard
      num={num}
      title="Quantity tiers"
      hint="Customers get the highest tier they reach. Quantities of the same product's variants count together."
      aside={`${tiers.length} / ${maxTiers}`}
    >
      <div className="bb-tiergrid">
        <div className="bb-tierhead" aria-hidden="true">
          <span />
          <span>Buy at least</span>
          <span>{percent ? "Discount" : "Off each item"}</span>
          <span>Label (optional)</span>
          <span />
        </div>
        {tiers.map((tier, i) => (
          <div key={i} className="bb-tierrow">
            <span className="bb-tierrow__num bb-mono" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="bb-tierrow__cell">
              <NumberField
                label={`Tier ${i + 1} minimum quantity`}
                labelHidden
                value={tier.minQuantity}
                min={minQuantity}
                max={CAMPAIGN_LIMITS.maxQuantity}
                step={1}
                suffix="items"
                error={errors[`tiers.${i}.minQuantity`]}
                disabled={disabled}
                onChange={(minQuantity) => update(i, { minQuantity })}
              />
            </div>
            <div className="bb-tierrow__cell">
              <NumberField
                label={`Tier ${i + 1} ${percent ? "discount" : "amount off each item"}`}
                labelHidden
                value={tier.value}
                min={0}
                max={percent ? 100 : CAMPAIGN_LIMITS.maxFixedAmount}
                step={percent ? 1 : 0.01}
                suffix={percent ? "% off" : (currencyCode ?? undefined)}
                error={errors[`tiers.${i}.value`]}
                disabled={disabled}
                onChange={(value) => update(i, { value })}
              />
            </div>
            <div className="bb-tierrow__cell bb-tierrow__label">
              <TextField
                label={`Tier ${i + 1} label`}
                labelHidden
                value={tier.label}
                placeholder="e.g. Most popular"
                maxLength={CAMPAIGN_LIMITS.labelMax}
                error={errors[`tiers.${i}.label`]}
                disabled={disabled}
                onChange={(label) => update(i, { label })}
              />
            </div>
            <s-button
              variant="tertiary"
              tone="critical"
              icon="delete"
              accessibilityLabel={`Remove tier ${i + 1}`}
              {...on({ disabled: disabled || tiers.length === 1 })}
              onClick={() => onChange(tiers.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
      {errors.tiers && <p className="bb-error">{errors.tiers}</p>}
      <div className="bb-actions">
        <s-button
          icon="plus"
          {...on({
            disabled: disabled || tiers.length >= maxTiers,
          })}
          onClick={addTier}
        >
          Add tier
        </s-button>
        {tiers.length >= maxTiers && limitNote}
      </div>
    </EditorCard>
  );
}
