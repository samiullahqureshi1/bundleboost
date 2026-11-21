import { useState, type CSSProperties } from "react";
import type { WidgetSettingsInput } from "../lib/settings-validation";

/**
 * Admin preview of the theme block. Uses the block's own markup and its real
 * stylesheet (extensions/bundleboost-widget/assets/quantity-breaks.css,
 * linked by the widget route), so what you see here is what shoppers see.
 * The product and price are a labelled sample.
 */
export type PreviewTier = { qty: number; value: number; label: string };

const SAMPLE_PRICE_CENTS = 2400;
export const SAMPLE_TIERS: PreviewTier[] = [
  { qty: 2, value: 5, label: "" },
  { qty: 3, value: 10, label: "Most popular" },
  { qty: 4, value: 15, label: "" },
];

function money(cents: number, currencyCode: string | null) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode ?? "USD" }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export function WidgetPreview({
  settings,
  tiers,
  type,
  currencyCode,
}: {
  settings: WidgetSettingsInput;
  tiers: PreviewTier[];
  type: "percentage" | "fixed";
  currencyCode: string | null;
}) {
  const [picked, setPicked] = useState(1);
  const selected = Math.min(picked, tiers.length - 1);
  const best = tiers[tiers.length - 1]?.qty;
  const vars = {
    "--bb-accent": settings.accentColor,
    "--bb-text": settings.textColor,
    "--bb-bg": settings.backgroundColor,
    "--bb-radius": `${settings.borderRadius}px`,
    margin: 0,
  } as CSSProperties;

  return (
    <div className={`bb-breaks bb-breaks--${settings.layout === "GRID" ? "grid" : "stacked"}`} style={vars}>
      <p className="bb-breaks__heading">{settings.heading}</p>
      <ul className="bb-breaks__tiers">
        {tiers.map((tier, i) => {
          const offCents = type === "percentage" ? Math.round((SAMPLE_PRICE_CENTS * tier.value) / 100) : tier.value * 100;
          const each = Math.max(SAMPLE_PRICE_CENTS - offCents, 0);
          const isBest = settings.highlightBestDeal && tier.qty === best;
          return (
            <li key={tier.qty}>
              <button
                type="button"
                className={`bb-breaks__tier${isBest ? " bb-breaks__tier--best" : ""}`}
                aria-pressed={i === selected}
                onClick={() => setPicked(i)}
              >
                {isBest && <span className="bb-breaks__badge">Best deal</span>}
                <span className="bb-breaks__qty">
                  Buy {tier.qty}+{tier.label && ` · ${tier.label}`}
                </span>
                <span className="bb-breaks__price">{money(each, currencyCode)} each</span>
                {settings.showSavings && (
                  <span className="bb-breaks__save">
                    {type === "percentage" ? `Save ${tier.value}%` : `Save ${money(tier.value * 100, currencyCode)} each`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
