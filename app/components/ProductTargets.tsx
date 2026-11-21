import { useAppBridge } from "@shopify/app-bridge-react";
import { on } from "./bool-attrs";
import { EditorCard } from "./EditorCard";

export type SelectedProduct = {
  productGid: string;
  title: string;
  imageUrl: string | null;
  /** Empty = all variants. */
  variantGids: string[];
  variantTitles: string[];
  totalVariants: number | null;
};

type PickerVariant = { id: string; title?: string };
type PickerProduct = {
  id: string;
  title: string;
  images?: { originalSrc?: string; url?: string }[];
  variants?: PickerVariant[];
  totalVariants?: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Product/variant targeting via the App Bridge resource picker. The picker
 * only supplies IDs for the server to verify; titles here are for display.
 */
export function ProductTargets({
  num,
  value,
  onChange,
  error,
  itemErrors,
  disabled,
}: {
  num: string;
  value: SelectedProduct[];
  onChange: (value: SelectedProduct[]) => void;
  error?: string;
  itemErrors: Record<number, string>;
  disabled?: boolean;
}) {
  const shopify = useAppBridge();

  async function openPicker() {
    const selected = (await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      filter: { variants: true, draft: false, archived: false },
      selectionIds: value.map((p) => ({
        id: p.productGid,
        ...(p.variantGids.length ? { variants: p.variantGids.map((id) => ({ id })) } : {}),
      })),
    })) as PickerProduct[] | undefined;
    if (!selected) return;

    onChange(
      selected.map((product) => {
        const variants = product.variants ?? [];
        const total = product.totalVariants ?? null;
        const allSelected = total !== null && variants.length >= total;
        return {
          productGid: product.id,
          title: product.title,
          imageUrl: product.images?.[0]?.originalSrc ?? product.images?.[0]?.url ?? null,
          variantGids: allSelected ? [] : variants.map((v) => v.id),
          variantTitles: allSelected ? [] : variants.map((v) => v.title ?? ""),
          totalVariants: total,
        };
      }),
    );
  }

  return (
    <EditorCard
      num={num}
      title="Products"
      hint="Choose the products this discount applies to. Pick individual variants to limit it to them."
      aside={value.length > 0 && plural(value.length, "product")}
    >
      {value.length > 0 ? (
        <ul className="bb-rows">
          {value.map((product, i) => (
            <li key={product.productGid} className="bb-product">
              <s-thumbnail src={product.imageUrl ?? undefined} alt={product.title} size="small" />
              <span style={{ minInlineSize: 0 }}>
                <strong>{product.title}</strong>
                <small className={itemErrors[i] ? "bb-product__error" : undefined}>
                  {itemErrors[i] ??
                    (product.variantGids.length
                      ? `${plural(product.variantGids.length, "variant")}: ${product.variantTitles.join(", ")}`
                      : "All variants")}
                </small>
              </span>
              <s-button
                variant="tertiary"
                icon="x"
                accessibilityLabel={`Remove ${product.title}`}
                {...on({ disabled })}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="bb-empty bb-placeholder">The discount only applies to the products you choose.</div>
      )}
      {error && <p className="bb-error">{error}</p>}
      <div className="bb-actions">
        <s-button icon="product" onClick={openPicker} {...on({ disabled })}>
          {value.length ? "Edit products" : "Select products"}
        </s-button>
        {value.length > 1 && (
          <s-button variant="tertiary" tone="critical" {...on({ disabled })} onClick={() => onChange([])}>
            Remove all
          </s-button>
        )}
      </div>
    </EditorCard>
  );
}
