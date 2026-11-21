import { useEffect, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LinksFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { requireAdmin } from "../.server/context";
import { toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { getWidgetSettings, updateWidgetSettings } from "../.server/services/settings.service";
import { syncStorefrontConfig } from "../.server/services/storefront-sync.service";
import { themeEditorUrl } from "../.server/theme";
import { getShopPlan } from "../.server/services/billing.service";
import { planFor, planFromHandle, type WidgetField } from "../lib/plans";
import { EditorCard } from "../components/EditorCard";
import { ColorField, NumberField, TextField } from "../components/Fields";
import { RouteError } from "../components/RouteError";
import { Toggle } from "../components/Toggle";
import { SAMPLE_TIERS, WidgetPreview, type PreviewTier } from "../components/WidgetPreview";
import { widgetSettingsSchema, type WidgetSettingsInput } from "../lib/settings-validation";
import blockStyles from "../../extensions/bundleboost-widget/assets/quantity-breaks.css?url";

// The theme block's own stylesheet, so the preview matches the storefront.
export const links: LinksFunction = () => [{ rel: "stylesheet", href: blockStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const [s, live, liveCount, { plan }] = await Promise.all([
    getWidgetSettings(shop.id),
    prisma.campaign.findFirst({
      where: { shopId: shop.id, status: "ACTIVE", syncStatus: "SYNCED" },
      orderBy: { updatedAt: "desc" },
      select: {
        name: true,
        discountType: true,
        products: { take: 1, select: { title: true, imageUrl: true } },
        tiers: { orderBy: { position: "asc" }, select: { minQuantity: true, value: true, label: true } },
      },
    }),
    prisma.campaign.count({ where: { shopId: shop.id, status: "ACTIVE", syncStatus: "SYNCED" } }),
    getShopPlan(shop.id, admin),
  ]);
  const settings: WidgetSettingsInput = {
    heading: s.heading,
    layout: s.layout,
    accentColor: s.accentColor,
    textColor: s.textColor,
    backgroundColor: s.backgroundColor,
    borderRadius: s.borderRadius,
    showSavings: s.showSavings,
    highlightBestDeal: s.highlightBestDeal,
  };
  return {
    settings,
    planHandle: plan.handle,
    currencyCode: shop.currencyCode,
    liveCount,
    previewCampaign: live && {
      name: live.name,
      productTitle: live.products[0]?.title ?? null,
      productImageUrl: live.products[0]?.imageUrl ?? null,
      type: live.discountType === "PERCENTAGE" ? ("percentage" as const) : ("fixed" as const),
      tiers: live.tiers.map((t) => ({ qty: t.minQuantity, value: Number(t.value), label: t.label ?? "" })),
    },
    publishedAt: shop.storefrontSyncedAt?.toISOString() ?? null,
    themeEditorUrl: themeEditorUrl(shop.domain),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireAdmin(request);
  try {
    const { plan } = await getShopPlan(shop.id, admin);
    await updateWidgetSettings({ shopId: shop.id, actorId, plan }, await readJsonBody(request));
    const storefront = await syncStorefrontConfig(admin, shop.id);
    return { ok: true as const, published: storefront.ok };
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "widget" });
  }
};

type Result =
  | { ok: true; published: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

// One click sets accent, text and background together.
const PRESETS: { name: string; accentColor: string; textColor: string; backgroundColor: string }[] = [
  { name: "Violet", accentColor: "#5B47E0", textColor: "#1D1B26", backgroundColor: "#FFFFFF" },
  { name: "Forest", accentColor: "#1F7A4C", textColor: "#16211B", backgroundColor: "#F7FAF7" },
  { name: "Ink", accentColor: "#18161F", textColor: "#18161F", backgroundColor: "#FFFFFF" },
  { name: "Coral", accentColor: "#D9553A", textColor: "#2A1A16", backgroundColor: "#FFF8F5" },
  { name: "Ocean", accentColor: "#1665C0", textColor: "#122033", backgroundColor: "#F5F9FF" },
];

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );

export default function WidgetCustomization() {
  const { settings: initial, planHandle, currencyCode, liveCount, previewCampaign, publishedAt, themeEditorUrl } =
    useLoaderData<typeof loader>();
  const plan = planFromHandle(planHandle);
  const can = (field: WidgetField) => plan.widget.includes(field);
  const lockNote = (field: WidgetField) => {
    const next = planFor((p) => p.widget.includes(field));
    return next ? `Available on ${next.name}` : undefined;
  };
  const [settings, setSettings] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const fetcher = useFetcher<Result>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const location = useLocation();

  const handleUpgradeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = `/app/billing${location.search}`;
    navigate(target);
    try {
      (window as unknown as { shopify?: { navigate?: (url: string) => void } }).shopify?.navigate?.(target);
    } catch {
      // Ignore if not in App Bridge context
    }
    document.dispatchEvent(
      new CustomEvent("shopify:navigate", {
        detail: { href: "/app/billing" },
        bubbles: true,
      }),
    );
  };
  const saving = fetcher.state !== "idle";
  const parsed = widgetSettingsSchema.safeParse(settings);
  const errors: Record<string, string> = fetcher.data && !fetcher.data.ok ? fetcher.data.fieldErrors ?? {} : {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[issue.path.join(".")] ??= issue.message;
  }
  const dirty = JSON.stringify(settings) !== JSON.stringify(baseline);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (!result.ok) {
      shopify.toast.show(result.message, { isError: true });
      return;
    }
    setBaseline(settings);
    shopify.toast.show(
      result.published ? "Saved and published to your store" : "Saved, but the store couldn’t be updated. Save again to retry.",
      { isError: !result.published },
    );
    // Only react to a finished save, not to edits made afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, shopify]);

  const set = <K extends keyof WidgetSettingsInput>(key: K, value: WidgetSettingsInput[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const save = () => {
    if (!parsed.success) {
      shopify.toast.show("Fix the highlighted fields", { isError: true });
      return;
    }
    fetcher.submit(settings, { method: "post", encType: "application/json" });
  };

  const tiers: PreviewTier[] = previewCampaign?.tiers.length ? previewCampaign.tiers : SAMPLE_TIERS;
  const activePreset = PRESETS.find(
    (p) =>
      p.accentColor.toLowerCase() === settings.accentColor.toLowerCase() &&
      (!can("textColor") || p.textColor.toLowerCase() === settings.textColor.toLowerCase()) &&
      (!can("backgroundColor") || p.backgroundColor.toLowerCase() === settings.backgroundColor.toLowerCase()),
  );

  return (
    <s-page heading="Widget" inlineSize="large">
      <SaveBar id="widget-save-bar" open={dirty}>
        <button variant="primary" onClick={save} {...(saving ? { loading: "" } : {})}>
          Save
        </button>
        <button onClick={() => setSettings(baseline)} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      <div className="bb-wrap">
        <header className="bb-pagehead">
          <span className="bb-kicker">
            Storefront block · {publishedAt ? `published ${when(publishedAt)}` : "not published yet"}
          </span>
          <h1 className="bb-display">
            Make the offer <em>yours</em>
          </h1>
          <p className="bb-lede">
            Style the quantity-break block shoppers see on product pages. Changes show in the preview right away and
            go live when you save.
          </p>
        </header>

        {liveCount === 0 && (
          <s-banner tone="info" heading="The block only shows for live campaigns">
            It appears on products in a campaign that’s active at checkout. You don’t have one live yet.
            <s-button slot="secondary-actions" href="/app/campaigns">
              Go to campaigns
            </s-button>
          </s-banner>
        )}

        <div className="bb-editor bb-editor--wide-aside">
          <div className="bb-stack">
            <EditorCard num="01" title="Content">
              <div className="bb-fields">
                <TextField
                  label="Heading"
                  value={settings.heading}
                  maxLength={80}
                  error={errors.heading}
                  onChange={(v) => set("heading", v)}
                />
                <div>
                  <span className="bb-fieldlabel" id="layout-label">
                    Layout
                  </span>
                  <fieldset className="bb-segment" aria-labelledby="layout-label">
                    {(
                      [
                        ["STACKED", "Stacked rows"],
                        ["GRID", "Side-by-side cards"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="layout"
                          value={value}
                          checked={settings.layout === value}
                          disabled={!can("layout")}
                          onChange={() => set("layout", value)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
                <div className="bb-toggles">
                  <Toggle
                    label="Show savings on each tier"
                    hint={can("showSavings") ? "“Save 10%” next to every quantity." : `${lockNote("showSavings")}. “Save 10%” next to every quantity.`}
                    disabled={!can("showSavings")}
                    checked={settings.showSavings}
                    onChange={(v) => set("showSavings", v)}
                  />
                  <Toggle
                    label="Highlight the best deal"
                    hint={can("highlightBestDeal") ? "A “Best deal” badge on the largest tier." : `${lockNote("highlightBestDeal")}. A “Best deal” badge on the largest tier.`}
                    disabled={!can("highlightBestDeal")}
                    checked={settings.highlightBestDeal}
                    onChange={(v) => set("highlightBestDeal", v)}
                  />
                </div>
              </div>
            </EditorCard>

            <EditorCard
              num="02"
              title="Colours and shape"
              hint={
                can("borderRadius") ? (
                  "Start from a preset, then fine-tune."
                ) : (
                  <>
                    Your {plan.name} plan includes {can("accentColor") ? "the accent colour and presets" : "the standard look"}.{" "}
                    <Link
                      className="bb-link"
                      to={{ pathname: "/app/billing", search: location.search }}
                      onClick={handleUpgradeClick}
                    >
                      Upgrade for full styling
                    </Link>
                  </>
                )
              }
            >
              <div className="bb-presets" role="group" aria-label="Colour presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="bb-preset"
                    aria-pressed={activePreset?.name === p.name}
                    disabled={!can("accentColor")}
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        accentColor: p.accentColor,
                        ...(can("textColor") ? { textColor: p.textColor } : {}),
                        ...(can("backgroundColor") ? { backgroundColor: p.backgroundColor } : {}),
                      }))
                    }
                  >
                    <span className="bb-preset__swatch" aria-hidden="true">
                      <i style={{ background: p.backgroundColor }} />
                      <i style={{ background: p.accentColor }} />
                      <i style={{ background: p.textColor }} />
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="bb-colorgrid">
                <ColorField
                  key={`accent-${activePreset?.name ?? "custom"}`}
                  label="Accent"
                  value={settings.accentColor}
                  error={errors.accentColor}
                  disabled={!can("accentColor")}
                  details={can("accentColor") ? undefined : lockNote("accentColor")}
                  onChange={(v) => set("accentColor", v)}
                />
                <ColorField
                  key={`text-${activePreset?.name ?? "custom"}`}
                  label="Text"
                  value={settings.textColor}
                  error={errors.textColor}
                  disabled={!can("textColor")}
                  details={can("textColor") ? undefined : lockNote("textColor")}
                  onChange={(v) => set("textColor", v)}
                />
                <ColorField
                  key={`bg-${activePreset?.name ?? "custom"}`}
                  label="Background"
                  value={settings.backgroundColor}
                  error={errors.backgroundColor}
                  disabled={!can("backgroundColor")}
                  details={can("backgroundColor") ? undefined : lockNote("backgroundColor")}
                  onChange={(v) => set("backgroundColor", v)}
                />
                <NumberField
                  label="Corner radius"
                  suffix="px"
                  min={0}
                  max={32}
                  step={1}
                  value={String(settings.borderRadius)}
                  error={errors.borderRadius}
                  disabled={!can("borderRadius")}
                  details={can("borderRadius") ? undefined : lockNote("borderRadius")}
                  onChange={(v) => set("borderRadius", Number(v))}
                />
              </div>
            </EditorCard>

            <EditorCard num="03" title="Add it to your theme">
              <ol className="bb-howto">
                <li>Open the theme editor. It starts on a product page with the BundleBoost block added.</li>
                <li>Drag the block under the price or the Add to cart button.</li>
                <li>Select Save in the theme editor.</li>
              </ol>
              <div className="bb-actions">
                <a className="bb-btn bb-btn--dark" href={themeEditorUrl} target="_top">
                  Open theme editor →
                </a>
                <Link className="bb-link" to="/app">
                  Back to setup steps
                </Link>
              </div>
            </EditorCard>
          </div>

          <aside className="bb-stack bb-editor__aside bb-sticky">
            <EditorCard
              title="Preview"
              aside={
                <fieldset className="bb-segment bb-segment--mini" aria-label="Preview size">
                  {(
                    [
                      ["desktop", "Desktop"],
                      ["mobile", "Mobile"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="device"
                        value={value}
                        checked={device === value}
                        onChange={() => setDevice(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              }
              hint={
                previewCampaign
                  ? `Tiers from “${previewCampaign.name}”. Sample product and price.`
                  : "Example tiers until you have a live campaign. Sample product and price."
              }
            >
              <div className={`bb-device bb-device--${device}`}>
                <div className="bb-mockpdp">
                  <div className="bb-mockpdp__image" aria-hidden="true">
                    {previewCampaign?.productImageUrl ? (
                      <img
                        src={previewCampaign.productImageUrl}
                        alt={previewCampaign.productTitle ?? "Product"}
                        className="bb-mockpdp__img"
                      />
                    ) : (
                      <div className="bb-mockpdp__tshirt">
                        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="bb-tshirt-svg">
                          <path
                            d="M32 20C35 27 42 31 50 31C58 31 65 27 68 20L86 30L76 50L68 45V82H32V45L24 50L14 30L32 20Z"
                            fill="#5B47E0"
                            fillOpacity="0.15"
                            stroke="#5B47E0"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M40 20C42 24 46 26 50 26C54 26 58 24 60 20"
                            stroke="#5B47E0"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                          <path
                            d="M24 50L32 45"
                            stroke="#5B47E0"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M76 50L68 45"
                            stroke="#5B47E0"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="bb-mockpdp__title">{previewCampaign?.productTitle ?? "BundleBoost Classic T-Shirt"}</div>
                  <div className="bb-mockpdp__price">{new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode ?? "USD" }).format(24)}</div>
                  {parsed.success ? (
                    <WidgetPreview
                      settings={parsed.data}
                      tiers={tiers}
                      type={previewCampaign?.type ?? "percentage"}
                      currencyCode={currencyCode}
                    />
                  ) : (
                    <div className="bb-empty bb-placeholder">Fix the highlighted fields to see the preview.</div>
                  )}
                  <div className="bb-mockpdp__cart" aria-hidden="true">
                    Add to cart
                  </div>
                </div>
              </div>
            </EditorCard>
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
