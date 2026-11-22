import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { findShopByDomain, onShopAuthenticated } from "./services/shop.service";
import { env } from "./env";

/**
 * Entry point for every embedded-admin loader and action. Authenticates the
 * request with Shopify (session token / token exchange), then resolves the
 * tenant record. All downstream data access is scoped by the returned
 * `shop.id`; the shop is never taken from request parameters.
 */
export async function requireAdmin(request: Request) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const isEmbedded =
    url.searchParams.get("embedded") === "1" ||
    Boolean(request.headers.get("authorization"));

  // Only a top-level browser tab (e.g. returning from a Shopify charge
  // confirmation outside the admin) is sent back into the embedded admin.
  // Loads inside the admin iframe report sec-fetch-dest "iframe" and must be
  // left to authenticate.admin; redirecting them to admin.shopify.com inside
  // the iframe is blocked by Shopify and breaks navigation.
  const isTopLevelDocument = request.headers.get("sec-fetch-dest") === "document";
  const shopParam = url.searchParams.get("shop");

  // The shop must come from the request; never guess it from the database,
  // which could send a merchant to another store's admin.
  if (!host && !isEmbedded && isTopLevelDocument && shopParam && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopParam)) {
    const cleanShop = shopParam.replace(/\.myshopify\.com$/i, "");
    const apiKey = env().SHOPIFY_API_KEY;
    url.searchParams.delete("shop");
    const query = url.searchParams.toString();
    throw redirect(
      `https://admin.shopify.com/store/${cleanShop}/apps/${apiKey}${url.pathname}${query ? `?${query}` : ""}`,
    );
  }

  const auth = await authenticate.admin(request);
  const { admin, session, sessionToken, redirect: authRedirect, billing } = auth;

  const existing = await findShopByDomain(session.shop);
  const shop =
    existing && !existing.uninstalledAt
      ? existing
      : await onShopAuthenticated(session.shop, admin);

  // `sub` is the id of the staff member using the app (embedded requests).
  const actorId = sessionToken?.sub ? String(sessionToken.sub) : null;

  return { admin, session, shop, actorId, redirect: authRedirect, billing };
}
