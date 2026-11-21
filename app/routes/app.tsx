import {
  Outlet,
  useLoaderData,
  useRouteError,
  type HeadersFunction,
  type LinksFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { requireAdmin } from "../.server/context";
import { env } from "../.server/env";
import styles from "../styles/bundleboost.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Authenticates and makes sure the tenant record exists.
  await requireAdmin(request);

  return { apiKey: env().SHOPIFY_API_KEY };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">
          Overview
        </s-link>
        <s-link href="/app/campaigns">Campaigns</s-link>
        <s-link href="/app/widget">Widget</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/billing">Billing</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
