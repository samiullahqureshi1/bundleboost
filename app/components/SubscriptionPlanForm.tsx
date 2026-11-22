import { useEffect, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import {
  frequencyName,
  SUBSCRIPTION_LIMITS,
  validateSubscriptionPlan,
  type FrequencyIntervalValue,
} from "../lib/subscription-plans";
import { on } from "./bool-attrs";
import { EditorCard } from "./EditorCard";
import { NumberField, SelectField, TextField } from "./Fields";
import { ProductTargets, type SelectedProduct } from "./ProductTargets";

export type FrequencyDraft = {
  interval: FrequencyIntervalValue;
  intervalCount: string;
  discountPercent: string;
  label: string;
};

export type SubscriptionPlanFormState = {
  name: string;
  optionName: string;
  frequencies: FrequencyDraft[];
  products: SelectedProduct[];
};

export const EMPTY_SUBSCRIPTION_PLAN: SubscriptionPlanFormState = {
  name: "Subscribe & save",
  optionName: "Delivery every",
  frequencies: [
    { interval: "MONTH", intervalCount: "1", discountPercent: "10", label: "" },
    { interval: "MONTH", intervalCount: "3", discountPercent: "15", label: "Quarterly" },
  ],
  products: [],
};

const UNIT_OPTIONS: { value: FrequencyIntervalValue; label: string }[] = [
  { value: "DAY", label: "Days" },
  { value: "WEEK", label: "Weeks" },
  { value: "MONTH", label: "Months" },
  { value: "YEAR", label: "Years" },
];

type ActionResult = { ok: true; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export function toPlanPayload(state: SubscriptionPlanFormState) {
  return {
    name: state.name,
    optionName: state.optionName,
    frequencies: state.frequencies.map((f) => ({
      interval: f.interval,
      intervalCount: f.intervalCount,
      discountPercent: f.discountPercent || "0",
      label: f.label,
    })),
    productGids: state.products.map((p) => p.productGid),
  };
}

const displayName = (f: FrequencyDraft) => {
  const count = Number(f.intervalCount);
  return f.label.trim() || (count >= 1 ? frequencyName(f.interval, count) : "New frequency");
};

/**
 * Editor for a subscription plan (Shopify selling plan group): its name, the
 * delivery frequencies shoppers choose from (each with its own discount and
 * optional name, e.g. "Quarterly"), and the products it's offered on.
 */
export function SubscriptionPlanForm({
  mode,
  initial,
  statusCard,
  footer,
}: {
  mode: "create" | "edit";
  initial: SubscriptionPlanFormState;
  statusCard?: ReactNode;
  footer?: ReactNode;
}) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const [state, setState] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [pickedPreview, setPickedPreview] = useState(0);
  const saving = fetcher.state !== "idle";
  const dirty = JSON.stringify(state) !== JSON.stringify(baseline);
  const serverErrors = fetcher.data && !fetcher.data.ok ? fetcher.data.fieldErrors ?? {} : {};
  const errors = { ...serverErrors, ...clientErrors };

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      setBaseline(state);
      shopify.toast.show(fetcher.data.message ?? "Subscription plan saved");
    } else if (!fetcher.data.fieldErrors) {
      shopify.toast.show(fetcher.data.message, { isError: true });
    }
    // Only react to a finished submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, shopify]);

  const set = <K extends keyof SubscriptionPlanFormState>(key: K, value: SubscriptionPlanFormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setClientErrors({});
  };
  const updateFrequency = (i: number, patch: Partial<FrequencyDraft>) =>
    set(
      "frequencies",
      state.frequencies.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    );
  // A new row starts at the next month count not in the plan yet (so it
  // isn't an instant duplicate); the merchant then picks any schedule.
  const addFrequency = () => {
    let count = 1;
    while (state.frequencies.some((f) => f.interval === "MONTH" && Number(f.intervalCount) === count)) count++;
    set("frequencies", [
      ...state.frequencies,
      { interval: "MONTH", intervalCount: String(count), discountPercent: "10", label: "" },
    ]);
  };

  function submit() {
    const payload = toPlanPayload(state);
    const result = validateSubscriptionPlan(payload);
    if (!result.success) {
      setClientErrors(result.fieldErrors);
      shopify.toast.show("Fix the fields marked in red", { isError: true });
      return;
    }
    fetcher.submit({ intent: "save", plan: payload }, { method: "post", encType: "application/json" });
  }

  const productItemErrors: Record<number, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const match = /^productGids\.(\d+)/.exec(key);
    if (match) productItemErrors[Number(match[1])] = message;
  }
  const previewIndex = Math.min(pickedPreview, Math.max(state.frequencies.length - 1, 0));
  const previewFrequency = state.frequencies[previewIndex];
  const issueCount = Object.keys(errors).length;

  return (
    <>
      <SaveBar id="subscription-plan-save-bar" open={dirty}>
        <button variant="primary" onClick={submit} {...(saving ? { loading: "" } : {})}>
          Save
        </button>
        <button onClick={() => setState(baseline)} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      <div className="bb-wrap">
        <header className="bb-edithead">
          <h1 className="bb-heading">{state.name.trim() || "New subscription plan"}</h1>
        </header>

        {issueCount > 0 && (
          <s-banner tone="critical" heading={`Fix ${issueCount} ${issueCount === 1 ? "issue" : "issues"} before saving`}>
            {fetcher.data && !fetcher.data.ok ? fetcher.data.message : "Check the fields marked in red below."}
          </s-banner>
        )}

        <div className="bb-editor">
          <div className="bb-stack">
            <EditorCard num="01" title="Plan" hint="Shoppers see these on the product page and at checkout.">
              <div className="bb-colorgrid">
                <TextField
                  label="Plan name"
                  value={state.name}
                  maxLength={SUBSCRIPTION_LIMITS.nameMax}
                  placeholder="Subscribe & save"
                  error={errors.name}
                  onChange={(v) => set("name", v)}
                />
                <TextField
                  label="Frequency label"
                  value={state.optionName}
                  maxLength={40}
                  placeholder="Delivery every"
                  error={errors.optionName}
                  onChange={(v) => set("optionName", v)}
                />
              </div>
            </EditorCard>

            <EditorCard
              num="02"
              title="Delivery frequencies"
              hint="Add any schedule: every N days, weeks, months or years. Each gets its own discount and an optional name such as “Quarterly”."
              aside={`${state.frequencies.length} / ${SUBSCRIPTION_LIMITS.maxFrequencies}`}
            >
              {errors.frequencies && <p className="bb-error">{errors.frequencies}</p>}
              <ul className="bb-freqedit">
                {state.frequencies.map((f, i) => (
                  <li key={i} className="bb-freqedit__row">
                    <span className="bb-freqedit__every">Every</span>
                    <div className="bb-freqedit__count">
                      <NumberField
                        label={`Frequency ${i + 1} count`}
                        labelHidden
                        value={f.intervalCount}
                        min={1}
                        max={SUBSCRIPTION_LIMITS.maxCount[f.interval]}
                        step={1}
                        error={errors[`frequencies.${i}.intervalCount`]}
                        onChange={(v) => updateFrequency(i, { intervalCount: v })}
                      />
                    </div>
                    <div className="bb-freqedit__unit">
                      <SelectField
                        label={`Frequency ${i + 1} unit`}
                        labelHidden
                        value={f.interval}
                        options={UNIT_OPTIONS}
                        error={errors[`frequencies.${i}.interval`]}
                        onChange={(v) => updateFrequency(i, { interval: v as FrequencyIntervalValue })}
                      />
                    </div>
                    <div className="bb-freqedit__discount">
                      <NumberField
                        label={`Frequency ${i + 1} discount`}
                        labelHidden
                        value={f.discountPercent}
                        min={0}
                        max={100}
                        step={1}
                        suffix="% off"
                        error={errors[`frequencies.${i}.discountPercent`]}
                        onChange={(v) => updateFrequency(i, { discountPercent: v })}
                      />
                    </div>
                    <div className="bb-freqedit__label">
                      <TextField
                        label={`Frequency ${i + 1} name`}
                        labelHidden
                        value={f.label}
                        placeholder={Number(f.intervalCount) >= 1 ? frequencyName(f.interval, Number(f.intervalCount)) : "Name"}
                        maxLength={SUBSCRIPTION_LIMITS.labelMax}
                        error={errors[`frequencies.${i}.label`]}
                        onChange={(v) => updateFrequency(i, { label: v })}
                      />
                    </div>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      icon="delete"
                      accessibilityLabel={`Remove ${displayName(f)}`}
                      {...on({ disabled: state.frequencies.length === 1 })}
                      onClick={() => set("frequencies", state.frequencies.filter((_, j) => j !== i))}
                    />
                  </li>
                ))}
              </ul>
              <div className="bb-actions">
                <button
                  type="button"
                  className="bb-btn bb-btn--glass bb-btn--small"
                  disabled={state.frequencies.length >= SUBSCRIPTION_LIMITS.maxFrequencies}
                  onClick={addFrequency}
                >
                  + Add frequency
                </button>
              </div>
            </EditorCard>

            <ProductTargets
              num="03"
              value={state.products}
              onChange={(v) => set("products", v.map((p) => ({ ...p, variantGids: [], variantTitles: [] })))}
              error={errors.productGids}
              itemErrors={productItemErrors}
            />

            {mode === "create" && (
              <div className="bb-actions bb-actions--end">
                <Link className="bb-btn bb-btn--glass" to="/app/subscriptions">
                  Cancel
                </Link>
                <button type="button" className="bb-btn bb-btn--dark" onClick={submit} disabled={saving}>
                  {saving && <span className="bb-spinner" aria-hidden="true" />}
                  {saving ? "Saving…" : "Create plan"}
                </button>
              </div>
            )}
            {footer}
          </div>

          <aside className="bb-stack bb-editor__aside">
            {statusCard}
            <EditorCard title="Preview" hint="How shoppers choose a frequency on the product page.">
              {previewFrequency ? (
                <div className="bb-subpreview">
                  <p className="bb-subpreview__title">
                    {state.name || "Subscribe & save"}
                    {Number(previewFrequency.discountPercent) > 0 && (
                      <span className="bb-subpreview__save"> · save {Number(previewFrequency.discountPercent)}%</span>
                    )}
                  </p>
                  <label className="bb-subpreview__label" htmlFor="bb-subpreview-select">
                    {state.optionName || "Delivery every"}
                  </label>
                  <select
                    id="bb-subpreview-select"
                    className="bb-subpreview__select"
                    value={previewIndex}
                    onChange={(e) => setPickedPreview(Number(e.currentTarget.value))}
                  >
                    {state.frequencies.map((f, i) => (
                      <option key={i} value={i}>
                        {displayName(f)}
                        {Number(f.discountPercent) > 0 ? ` (${Number(f.discountPercent)}% off)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="bb-empty bb-placeholder">Add a frequency to see it here.</div>
              )}
            </EditorCard>
          </aside>
        </div>
      </div>
    </>
  );
}
