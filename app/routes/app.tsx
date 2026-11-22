import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
  type HeadersFunction,
  type LinksFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
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
      <NavMenu>
        <Link to="/app" rel="home">
          Overview
        </Link>
        <Link to="/app/campaigns">Campaigns</Link>
        <Link to="/app/subscriptions">Subscriptions</Link>
        <Link to="/app/subscribers">Subscribers</Link>
        <Link to="/app/widget">Widget</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/billing">Billing</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
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
