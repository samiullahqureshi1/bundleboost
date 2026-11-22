import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import {
  changeSubscription,
  loadSubscriptions,
  PortalError,
  quoteAddress,
  saveAddress,
  type Action,
  type AddressInput,
  type ShippingQuote,
  type Subscription,
} from "./api";

/**
 * "My subscriptions": the customer's BundleBoost subscriptions in their
 * Shopify customer account. The list is at the page root; each subscription
 * opens at /<contract number>.
 */
export default async () => {
  render(<SubscriptionsPage />, document.body);
};

const t = (key: string, options?: Record<string, string | number>) => shopify.i18n.translate(key, options);
const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);
const money = (amount: string | number, currency: string) =>
  shopify.i18n.formatCurrency(Number(amount), { currency });
const date = (iso: string) => shopify.i18n.formatDate(new Date(iso), { dateStyle: "long" });

function useCurrentPath() {
  const [entry, update] = useReducer(() => navigation.currentEntry, navigation.currentEntry);
  useEffect(() => {
    navigation.addEventListener("currententrychange", update);
    return () => navigation.removeEventListener("currententrychange", update);
  }, []);
  return entry?.url ? new URL(entry.url).pathname : "/";
}

function SubscriptionsPage() {
  const path = useCurrentPath();
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setSubscriptions(await loadSubscriptions());
    } catch (e) {
      setError(e instanceof PortalError ? e.message : t("errors.generic"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const replace = (updated: Subscription) =>
    setSubscriptions((list) => (list ?? []).map((s) => (s.id === updated.id ? updated : s)));

  const match = path.match(/(\d+)\/?$/);
  const selected = match && subscriptions ? subscriptions.find((s) => numericId(s.id) === match[1]) : null;

  if (error && !subscriptions) {
    return (
      <s-page heading={t("page.heading")}>
        <s-banner tone="critical" heading={t("errors.loadHeading")}>
          <s-stack direction="block" gap="base">
            <s-text>{error}</s-text>
            <s-button onClick={load}>{t("actions.tryAgain")}</s-button>
          </s-stack>
        </s-banner>
      </s-page>
    );
  }

  if (!subscriptions) {
    return (
      <s-page heading={t("page.heading")}>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-skeleton-paragraph />
            <s-skeleton-paragraph />
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (match && !selected) {
    return (
      <s-page heading={t("page.heading")}>
        <s-button slot="breadcrumb-actions" accessibilityLabel={t("actions.back")} onClick={() => navigation.navigate("extension://")} />
        <s-banner tone="warning" heading={t("errors.notFound")} />
      </s-page>
    );
  }

  if (selected) return <SubscriptionDetail subscription={selected} onChange={replace} onReload={load} />;
  return <SubscriptionList subscriptions={subscriptions} />;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

// Customer account badges come in auto (default), neutral and critical.
const STATUS_TONE: Record<Subscription["status"], "auto" | "critical" | "neutral"> = {
  ACTIVE: "auto",
  PAUSED: "neutral",
  FAILED: "critical",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

function StatusBadge({ status }: { status: Subscription["status"] }) {
  return <s-badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</s-badge>;
}

function title(subscription: Subscription) {
  const [first, ...rest] = subscription.lines;
  if (!first) return t("list.subscription");
  return rest.length ? t("list.titleMore", { title: first.title, count: rest.length }) : first.title;
}

function SubscriptionList({ subscriptions }: { subscriptions: Subscription[] }) {
  const current = subscriptions.filter((s) => s.status !== "CANCELLED" && s.status !== "EXPIRED");
  const past = subscriptions.filter((s) => s.status === "CANCELLED" || s.status === "EXPIRED");

  if (!subscriptions.length) {
    return (
      <s-page heading={t("page.heading")}>
        <s-section>
          <s-stack direction="block" gap="base" alignItems="center">
            <s-icon type="reorder" />
            <s-heading>{t("list.emptyHeading")}</s-heading>
            <s-paragraph color="subdued">{t("list.emptyBody")}</s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={t("page.heading")} subheading={t("page.subheading")}>
      <s-stack direction="block" gap="large">
        {current.length > 0 && (
          <s-section heading={t("list.current")}>
            <s-stack direction="block" gap="base">
              {current.map((s) => (
                <SubscriptionCard key={s.id} subscription={s} />
              ))}
            </s-stack>
          </s-section>
        )}
        {past.length > 0 && (
          <s-section heading={t("list.past")}>
            <s-stack direction="block" gap="base">
              {past.map((s) => (
                <SubscriptionCard key={s.id} subscription={s} />
              ))}
            </s-stack>
          </s-section>
        )}
      </s-stack>
    </s-page>
  );
}

function SubscriptionCard({ subscription: s }: { subscription: Subscription }) {
  const image = s.lines.find((l) => l.imageUrl);
  const ended = s.status === "CANCELLED" || s.status === "EXPIRED";
  return (
    <s-clickable
      href={`extension://${numericId(s.id)}`}
      accessibilityLabel={t("list.manage", { title: title(s) })}
      border="base"
      borderRadius="base"
      padding="base"
    >
      <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
        <s-product-thumbnail src={image?.imageUrl ?? ""} alt={image?.imageAlt ?? ""} size="base" />
        <s-stack direction="block" gap="small-300">
          <s-text type="strong">{title(s)}</s-text>
          <s-text color="subdued">
            {t("list.summary", { frequency: s.frequency, amount: money(s.amount, s.currencyCode) })}
          </s-text>
          {!ended && s.status === "ACTIVE" && s.nextBillingDate && (
            <s-text color="subdued">{t("list.nextOrder", { date: date(s.nextBillingDate) })}</s-text>
          )}
          {s.skippedDate && <s-text color="subdued">{t("detail.skippedOn", { date: date(s.skippedDate) })}</s-text>}
        </s-stack>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <StatusBadge status={s.status} />
          <s-icon type="chevron-right" />
        </s-stack>
      </s-grid>
    </s-clickable>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

type ConfirmKind = "skip" | "pause" | "cancel";

function SubscriptionDetail({
  subscription: s,
  onChange,
  onReload,
}: {
  subscription: Subscription;
  onChange: (s: Subscription) => void;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>("skip");
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const ended = s.status === "CANCELLED" || s.status === "EXPIRED";

  async function run(action: Action, done?: string) {
    setBusy(action.action);
    setError(null);
    try {
      onChange(await changeSubscription(s.id, action, s.address));
      if (done) shopify.toast.show(done);
      return true;
    } catch (e) {
      setError(e instanceof PortalError ? e.message : t("errors.generic"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirmed() {
    const ok = await run({ action: confirm }, t(`done.${confirm}`));
    if (ok) modal.current?.hideOverlay();
  }

  const openConfirm = (kind: ConfirmKind) => () => {
    setError(null);
    setConfirm(kind);
  };

  return (
    <s-page heading={title(s)} subheading={t("detail.subheading", { date: date(s.createdAt) })}>
      <s-button slot="breadcrumb-actions" accessibilityLabel={t("actions.back")} onClick={() => navigation.navigate("extension://")} />
      {!ended && s.status === "ACTIVE" && s.nextBillingDate && (
        <s-button
          slot="secondary-actions"
          commandFor="bb-confirm"
          command="--show"
          disabled={Boolean(busy)}
          onClick={openConfirm("skip")}
        >
          {t("actions.skip")}
        </s-button>
      )}

      <s-stack direction="block" gap="large">
        {error && (
          <s-banner tone="critical" dismissible onDismiss={() => setError(null)}>
            {error}
          </s-banner>
        )}
        {s.failedCharges.length > 0 && !ended && (
          <s-banner tone="critical" heading={t("detail.failedHeading")}>
            <s-stack direction="block" gap="small-200">
              <s-text>{t("detail.failedBody", { date: date(s.failedCharges[0].date), reason: s.failedCharges[0].message })}</s-text>
              {s.payment && (
                <s-button loading={busy === "payment"} onClick={() => run({ action: "payment" }, t("done.payment"))}>
                  {t("payment.update")}
                </s-button>
              )}
            </s-stack>
          </s-banner>
        )}

        <Overview subscription={s} />

        {s.skippedDate && (
          <s-banner tone="info" heading={t("detail.skippedHeading")}>
            <s-stack direction="block" gap="small-200">
              <s-text>{t("detail.skippedBody", { date: date(s.skippedDate) })}</s-text>
              <s-button loading={busy === "unskip"} disabled={Boolean(busy) && busy !== "unskip"} onClick={() => run({ action: "unskip" }, t("done.unskip"))}>
                {t("actions.unskip")}
              </s-button>
            </s-stack>
          </s-banner>
        )}

        <Items subscription={s} />

        {!ended && (
          <s-section heading={t("manage.heading")}>
            <s-stack direction="block" gap="base">
              <s-paragraph color="subdued">{t("manage.body")}</s-paragraph>
              <s-stack direction="inline" gap="base">
                {s.status === "ACTIVE" && s.nextBillingDate && (
                  <s-button commandFor="bb-confirm" command="--show" disabled={Boolean(busy)} onClick={openConfirm("skip")}>
                    {t("actions.skip")}
                  </s-button>
                )}
                {s.status === "ACTIVE" ? (
                  <s-button commandFor="bb-confirm" command="--show" disabled={Boolean(busy)} onClick={openConfirm("pause")}>
                    {t("actions.pause")}
                  </s-button>
                ) : (
                  <s-button
                    variant="primary"
                    loading={busy === "resume"}
                    disabled={Boolean(busy) && busy !== "resume"}
                    onClick={() => run({ action: "resume" }, t("done.resume"))}
                  >
                    {t("actions.resume")}
                  </s-button>
                )}
                <s-button tone="critical" commandFor="bb-confirm" command="--show" disabled={Boolean(busy)} onClick={openConfirm("cancel")}>
                  {t("actions.cancel")}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        )}

        {!ended && s.frequencies.length > 1 && (
          <FrequencySection subscription={s} busy={busy} onSave={(frequencyId) => run({ action: "frequency", frequencyId }, t("done.frequency"))} />
        )}

        {!ended && (
          <s-grid gridTemplateColumns="1fr 1fr" gap="large">
            <s-grid-item>
              <PaymentSection subscription={s} busy={busy} onUpdate={() => run({ action: "payment" }, t("done.payment"))} />
            </s-grid-item>
            <s-grid-item>
              <AddressSection subscription={s} onSaved={onReload} />
            </s-grid-item>
          </s-grid>
        )}

        <HistorySection subscription={s} />
      </s-stack>

      <s-modal id="bb-confirm" ref={modal} heading={t(`confirm.${confirm}.heading`)}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {confirm === "skip" && s.nextBillingDate
              ? t("confirm.skip.body", { date: date(s.nextBillingDate) })
              : t(`confirm.${confirm}.body`)}
          </s-paragraph>
          {error && <s-banner tone="critical">{error}</s-banner>}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          tone={confirm === "cancel" ? "critical" : "auto"}
          loading={busy === confirm}
          onClick={confirmed}
        >
          {t(`confirm.${confirm}.confirm`)}
        </s-button>
        <s-button slot="secondary-actions" commandFor="bb-confirm" command="--hide" disabled={busy === confirm}>
          {t("confirm.keep")}
        </s-button>
      </s-modal>
    </s-page>
  );
}

function Overview({ subscription: s }: { subscription: Subscription }) {
  const nextOrder =
    s.status === "ACTIVE" && s.nextBillingDate
      ? date(s.nextBillingDate)
      : s.status === "PAUSED" || s.status === "FAILED"
        ? t("detail.pausedNext")
        : "—";
  return (
    <s-section>
      <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
        <Fact label={t("detail.status")}>
          <StatusBadge status={s.status} />
        </Fact>
        <Fact label={t("detail.nextOrder")}>
          <s-text type="strong">{nextOrder}</s-text>
        </Fact>
        <Fact label={t("detail.amount")}>
          <s-stack direction="block" gap="none">
            <s-text type="strong">{money(s.amount, s.currencyCode)}</s-text>
            {s.deliveryPrice !== null && (
              <s-text color="subdued">
                {Number(s.deliveryPrice) > 0
                  ? t("detail.plusShipping", { amount: money(s.deliveryPrice, s.currencyCode) })
                  : t("detail.freeShipping")}
              </s-text>
            )}
          </s-stack>
        </Fact>
        <Fact label={t("detail.frequency")}>
          <s-text type="strong">{s.frequency}</s-text>
        </Fact>
      </s-grid>
    </s-section>
  );
}

function Fact({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <s-grid-item>
      <s-stack direction="block" gap="small-300">
        <s-text color="subdued">{label}</s-text>
        {children}
      </s-stack>
    </s-grid-item>
  );
}

function Items({ subscription: s }: { subscription: Subscription }) {
  return (
    <s-section heading={t("items.heading")}>
      <s-stack direction="block" gap="base">
        {s.lines.map((line, i) => (
          <s-grid key={i} gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
            <s-product-thumbnail src={line.imageUrl ?? ""} alt={line.imageAlt ?? line.title} size="small" />
            <s-stack direction="block" gap="none">
              <s-text type="strong">{line.title}</s-text>
              {line.variantTitle && <s-text color="subdued">{line.variantTitle}</s-text>}
              <s-text color="subdued">{t("items.quantity", { quantity: line.quantity })}</s-text>
            </s-stack>
            <s-text>{money(Number(line.price) * line.quantity, s.currencyCode)}</s-text>
          </s-grid>
        ))}
      </s-stack>
    </s-section>
  );
}

function FrequencySection({
  subscription: s,
  busy,
  onSave,
}: {
  subscription: Subscription;
  busy: string | null;
  onSave: (frequencyId: string) => Promise<boolean>;
}) {
  const current = s.frequencies.find((f) => f.current)?.id ?? s.frequencies[0].id;
  const [choice, setChoice] = useState(current);
  useEffect(() => setChoice(current), [current]);
  const chosen = s.frequencies.find((f) => f.id === choice);

  return (
    <s-section heading={t("frequency.heading")}>
      <s-stack direction="block" gap="base">
        <s-select
          label={t("frequency.label")}
          value={choice}
          onChange={(event) => setChoice((event.currentTarget as HTMLSelectElement).value)}
        >
          {s.frequencies.map((f) => (
            <s-option key={f.id} value={f.id}>
              {f.discountPercent > 0 ? t("frequency.optionSave", { label: f.label, percent: f.discountPercent }) : f.label}
            </s-option>
          ))}
        </s-select>
        {chosen && choice !== current && <s-text color="subdued">{t("frequency.note")}</s-text>}
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            disabled={choice === current || (Boolean(busy) && busy !== "frequency")}
            loading={busy === "frequency"}
            onClick={() => onSave(choice)}
          >
            {t("frequency.save")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function PaymentSection({
  subscription: s,
  busy,
  onUpdate,
}: {
  subscription: Subscription;
  busy: string | null;
  onUpdate: () => Promise<boolean>;
}) {
  return (
    <s-section heading={t("payment.heading")}>
      <s-stack direction="block" gap="base">
        {s.payment ? (
          <s-stack direction="block" gap="none">
            <s-text type="strong">{s.payment.description}</s-text>
            {s.payment.expires && <s-text color="subdued">{t("payment.expires", { date: s.payment.expires })}</s-text>}
          </s-stack>
        ) : (
          <s-text color="subdued">{t("payment.none")}</s-text>
        )}
        {s.payment && (
          <s-stack direction="block" gap="small-200">
            <s-button loading={busy === "payment"} disabled={Boolean(busy) && busy !== "payment"} onClick={onUpdate}>
              {t("payment.update")}
            </s-button>
            <s-text color="subdued">{t("payment.updateHelp")}</s-text>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

function formatAddress(a: NonNullable<Subscription["address"]>) {
  return [
    [a.firstName, a.lastName].filter(Boolean).join(" "),
    a.address1,
    a.address2,
    [a.city, a.provinceCode || a.province, a.zip].filter(Boolean).join(", "),
    a.country || a.countryCode,
  ].filter((line): line is string => Boolean(line));
}

function AddressSection({ subscription: s, onSaved }: { subscription: Subscription; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AddressInput>(() => toInput(s.address));
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  function toInput(a: Subscription["address"]): AddressInput {
    return {
      firstName: a?.firstName ?? "",
      lastName: a?.lastName ?? "",
      address1: a?.address1 ?? "",
      address2: a?.address2 ?? "",
      city: a?.city ?? "",
      zoneCode: a?.provinceCode ?? "",
      countryCode: a?.countryCode ?? "",
      zip: a?.zip ?? "",
    };
  }

  const field = (name: keyof AddressInput) => ({
    name,
    value: form[name] ?? "",
    onInput: (event: Event) => {
      const value = (event.currentTarget as HTMLInputElement).value;
      setForm((f) => ({ ...f, [name]: value }));
      setQuote(null);
    },
  });

  function cleaned(): AddressInput {
    const value: AddressInput = {
      ...form,
      countryCode: (form.countryCode ?? "").trim().toUpperCase(),
      zoneCode: (form.zoneCode ?? "").trim().toUpperCase(),
    };
    if (!value.address2?.trim()) delete value.address2;
    if (!value.zoneCode) delete value.zoneCode;
    return value;
  }

  async function check() {
    const value = cleaned();
    if (!value.address1.trim() || !value.city.trim() || !/^[A-Z]{2}$/.test(value.countryCode)) {
      setError(t("address.required"));
      return;
    }
    setState("checking");
    setError(null);
    try {
      setQuote(await quoteAddress(s.id, value));
    } catch (e) {
      setError(e instanceof PortalError ? e.message : t("errors.generic"));
    } finally {
      setState("idle");
    }
  }

  async function save() {
    if (!quote) return;
    setState("saving");
    setError(null);
    try {
      await saveAddress(s.id, quote.token, cleaned());
      shopify.toast.show(t("done.address"));
      setEditing(false);
      setQuote(null);
      onSaved();
    } catch (e) {
      setError(e instanceof PortalError ? e.message : t("errors.generic"));
    } finally {
      setState("idle");
    }
  }

  if (!editing) {
    return (
      <s-section heading={t("address.heading")}>
        <s-stack direction="block" gap="base">
          {s.address ? (
            <s-stack direction="block" gap="none">
              {formatAddress(s.address).map((line, i) => (
                <s-text key={i}>{line}</s-text>
              ))}
            </s-stack>
          ) : (
            <s-text color="subdued">{t("address.none")}</s-text>
          )}
          {s.address && (
            <s-button
              onClick={() => {
                setForm(toInput(s.address));
                setEditing(true);
              }}
            >
              {t("address.change")}
            </s-button>
          )}
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section heading={t("address.heading")}>
      <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-text-field label={t("address.firstName")} autocomplete="shipping given-name" {...field("firstName")} />
          <s-text-field label={t("address.lastName")} autocomplete="shipping family-name" {...field("lastName")} />
        </s-grid>
        <s-text-field label={t("address.address1")} autocomplete="shipping address-line1" required {...field("address1")} />
        <s-text-field label={t("address.address2")} autocomplete="shipping address-line2" {...field("address2")} />
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-text-field label={t("address.city")} autocomplete="shipping address-level2" required {...field("city")} />
          <s-text-field label={t("address.zip")} autocomplete="shipping postal-code" {...field("zip")} />
        </s-grid>
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-text-field label={t("address.zone")} {...field("zoneCode")} />
          <s-text-field label={t("address.country")} autocomplete="shipping country" required {...field("countryCode")} />
        </s-grid>
        {quote && (
          <s-banner tone="success" heading={t("address.quoteHeading")}>
            {quote.price
              ? t("address.quoteBody", { method: quote.title, amount: money(quote.price.amount, quote.price.currencyCode) })
              : t("address.quoteBodyNoPrice", { method: quote.title })}
          </s-banner>
        )}
        <s-stack direction="inline" gap="base">
          {quote ? (
            <s-button variant="primary" loading={state === "saving"} onClick={save}>
              {t("address.save")}
            </s-button>
          ) : (
            <s-button variant="primary" loading={state === "checking"} onClick={check}>
              {t("address.check")}
            </s-button>
          )}
          <s-button
            disabled={state !== "idle"}
            onClick={() => {
              setEditing(false);
              setQuote(null);
              setError(null);
            }}
          >
            {t("actions.discard")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

const FULFILLMENT_KEYS = ["FULFILLED", "UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "ON_HOLD", "SCHEDULED", "RESTOCKED"];

function fulfillmentLabel(status: string) {
  if (FULFILLMENT_KEYS.includes(status)) return t(`fulfillment.${status}`);
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function HistorySection({ subscription: s }: { subscription: Subscription }) {
  return (
    <s-section heading={t("history.heading")}>
      {s.orders.length === 0 ? (
        <s-text color="subdued">{t("history.empty")}</s-text>
      ) : (
        <s-stack direction="block" gap="small-200">
          {s.orders.map((order, i) => (
            <s-stack key={order.id} direction="block" gap="small-200">
              {i > 0 && <s-divider />}
              <s-grid gridTemplateColumns="1fr auto auto" gap="base" alignItems="center">
                <s-stack direction="block" gap="none">
                  <s-link href={`shopify:customer-account/orders/${numericId(order.id)}`}>{order.name}</s-link>
                  <s-text color="subdued">{date(order.createdAt)}</s-text>
                </s-stack>
                <s-badge tone={order.fulfillment === "FULFILLED" ? "auto" : "neutral"}>{fulfillmentLabel(order.fulfillment)}</s-badge>
                <s-text type="strong">{money(order.total, order.currencyCode)}</s-text>
              </s-grid>
            </s-stack>
          ))}
        </s-stack>
      )}
      {s.failedCharges.length > 0 && (
        <s-stack direction="block" gap="small-200">
          <s-divider />
          <s-text type="strong">{t("history.failedHeading")}</s-text>
          {s.failedCharges.map((c, i) => (
            <s-text key={i} color="subdued">
              {t("history.failedLine", { date: date(c.date), reason: c.message })}
            </s-text>
          ))}
        </s-stack>
      )}
    </s-section>
  );
}
