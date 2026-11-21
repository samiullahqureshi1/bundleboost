import { useLoaderData, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { getShopPlan, getUsage, planSelectionUrl } from "../.server/services/billing.service";
import { BillingView } from "../components/billing/BillingView";
import { RouteError } from "../components/RouteError";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  // Always confirm with Shopify here (this is also where merchants land back
  // from the plan page with ?plan_handle=, which is never trusted on its own).
  const [shopPlan, usage] = await Promise.all([
    getShopPlan(shop.id, admin, { fresh: true }),
    getUsage(shop.id),
  ]);
  return {
    planHandle: shopPlan.plan.handle,
    verified: shopPlan.verified,
    configured: shopPlan.configured,
    renewsAt: shopPlan.renewsAt,
    trialEndsAt: shopPlan.trialEndsAt,
    cancelAtEndOfCycle: shopPlan.cancelAtEndOfCycle,
    pendingPlanHandle: shopPlan.pendingPlan?.handle ?? null,
    plansUrl: planSelectionUrl(shop.domain),
    usage,
  };
};

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  return <BillingView data={data} />;
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
