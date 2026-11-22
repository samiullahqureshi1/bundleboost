import { type ActionFunctionArgs, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { createSubscriptionPlan } from "../.server/services/subscription-plan.service";
import { RouteError } from "../components/RouteError";
import { EMPTY_SUBSCRIPTION_PLAN, SubscriptionPlanForm } from "../components/SubscriptionPlanForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId, redirect } = await requireAdmin(request);
  try {
    const body = (await readJsonBody(request)) as { plan?: unknown };
    const result = await createSubscriptionPlan({ shopId: shop.id, actorId, admin }, body.plan);
    return redirect(`/app/subscriptions/${result.id}?created=1`);
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "subscriptions.new" });
  }
};

export default function NewSubscriptionPlan() {
  return (
    <s-page heading="Create subscription plan" inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/subscriptions">
        Subscriptions
      </s-link>
      <SubscriptionPlanForm mode="create" initial={EMPTY_SUBSCRIPTION_PLAN} />
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
