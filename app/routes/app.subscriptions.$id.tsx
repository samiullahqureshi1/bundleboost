import { useEffect } from "react";
import {
  data,
  useFetcher,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { requireAdmin } from "../.server/context";
import { NotFoundError, toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import {
  deleteSubscriptionPlan,
  getSubscriptionPlan,
  syncSubscriptionPlan,
  updateSubscriptionPlan,
} from "../.server/services/subscription-plan.service";
import { fetchProductsByIds } from "../.server/shopify/products";
import { on } from "../components/bool-attrs";
import { RouteError } from "../components/RouteError";
import { SubscriptionPlanForm } from "../components/SubscriptionPlanForm";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  try {
    const plan = await getSubscriptionPlan(shop.id, params.id ?? "");
    // Variant counts for the product list come from Shopify; titles are stored.
    const live = await fetchProductsByIds(admin, plan.products.map((p) => p.productGid)).catch(() => new Map());
    return {
      plan: {
        id: plan.id,
        name: plan.name,
        optionName: plan.optionName,
        syncStatus: plan.syncStatus,
        syncError: plan.syncError,
        lastSyncedAt: plan.lastSyncedAt?.toISOString() ?? null,
        frequencies: plan.frequencies.map((f) => ({
          interval: f.interval,
          intervalCount: String(f.intervalCount),
          discountPercent: String(Number(f.discountPercent)),
          label: f.label ?? "",
        })),
        products: plan.products.map((p) => ({
          productGid: p.productGid,
          title: p.title,
          imageUrl: p.imageUrl,
          variantGids: [] as string[],
          variantTitles: [] as string[],
          totalVariants: live.get(p.productGid)?.variants.length ?? null,
        })),
      },
    };
  } catch (error) {
    if (error instanceof NotFoundError) throw data(null, { status: 404 });
    throw error;
  }
};

const intentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("save"), plan: z.unknown() }),
  z.object({ intent: z.literal("sync") }),
  z.object({ intent: z.literal("delete") }),
]);

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, shop, actorId, redirect } = await requireAdmin(request);
  const ctx = { shopId: shop.id, actorId, admin };
  const id = params.id ?? "";
  try {
    const body = intentSchema.parse(await readJsonBody(request));
    if (body.intent === "delete") {
      await deleteSubscriptionPlan(ctx, id);
      return redirect("/app/subscriptions");
    }
    if (body.intent === "sync") {
      const sync = await syncSubscriptionPlan(admin, shop.id, id);
      return sync.ok
        ? { ok: true as const, message: "Saved to Shopify" }
        : { ok: false as const, message: `Shopify couldn’t save the plan: ${sync.error}` };
    }
    const result = await updateSubscriptionPlan(ctx, id, body.plan);
    return result.sync.ok
      ? { ok: true as const, message: "Plan saved" }
      : { ok: true as const, message: "Saved, but Shopify couldn’t be updated. Retry from the status card." };
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "subscriptions.$id" });
  }
};

export default function EditSubscriptionPlan() {
  const { plan } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const shopify = useAppBridge();
  const [params, setParams] = useSearchParams();
  const busy = fetcher.state !== "idle";
  // Which button is working, so only that one shows a spinner.
  const pending = busy ? (fetcher.json as { intent?: string } | undefined)?.intent : undefined;

  useEffect(() => {
    if (params.get("created")) {
      shopify.toast.show(plan.syncStatus === "SYNCED" ? "Plan created on Shopify" : "Plan saved, but Shopify couldn’t be updated");
      setParams({}, { replace: true });
    }
  }, [params, setParams, shopify, plan.syncStatus]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const send = (intent: "sync" | "delete") =>
    fetcher.submit({ intent }, { method: "post", encType: "application/json" });

  return (
    <s-page heading={plan.name} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/subscriptions">
        Subscriptions
      </s-link>
      <SubscriptionPlanForm
        key={plan.id}
        mode="edit"
        initial={{ name: plan.name, optionName: plan.optionName, frequencies: plan.frequencies, products: plan.products }}
        statusCard={
          <section className="bb-glass bb-editcard">
            <header className="bb-cardhead">
              <h2>Status</h2>
            </header>
            <div className="bb-statusline">
              <span
                className={`bb-state bb-state--${plan.syncStatus === "SYNCED" ? "live" : plan.syncStatus === "ERROR" ? "alert" : "draft"}`}
              >
                {plan.syncStatus === "SYNCED" ? "On Shopify" : plan.syncStatus === "ERROR" ? "Not saved to Shopify" : "Not saved yet"}
              </span>
            </div>
            {plan.syncError && <p className="bb-statusnote">{plan.syncError}</p>}
            {plan.syncStatus !== "SYNCED" && (
              <s-button {...on({ disabled: busy, loading: pending === "sync" })} onClick={() => send("sync")}>
                Retry saving to Shopify
              </s-button>
            )}
          </section>
        }
        footer={
          <div className="bb-actions">
            <s-button
              tone="critical"
              variant="tertiary"
              {...on({ disabled: busy, loading: pending === "delete" })}
              onClick={() => {
                if (confirm("Delete this plan? Shoppers can no longer subscribe with it. Existing subscriptions keep their terms.")) send("delete");
              }}
            >
              Delete plan
            </s-button>
          </div>
        }
      />
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
