import { useLoaderData, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { getAnalytics } from "../.server/services/analytics.service";
import { AnalyticsView } from "../components/analytics/AnalyticsView";
import { RouteError } from "../components/RouteError";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const data = await getAnalytics(shop.id, admin);
  return { ...data, currencyCode: shop.currencyCode };
};

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  return <AnalyticsView data={data} />;
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
