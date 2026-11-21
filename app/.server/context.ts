import { authenticate } from "../shopify.server";
import { findShopByDomain, onShopAuthenticated } from "./services/shop.service";

/**
 * Entry point for every embedded-admin loader and action. Authenticates the
 * request with Shopify (session token / token exchange), then resolves the
 * tenant record. All downstream data access is scoped by the returned
 * `shop.id`; the shop is never taken from request parameters.
 */
export async function requireAdmin(request: Request) {
  const { admin, session, sessionToken, redirect } =
    await authenticate.admin(request);

  const existing = await findShopByDomain(session.shop);
  const shop =
    existing && !existing.uninstalledAt
      ? existing
      : await onShopAuthenticated(session.shop, admin);

  // `sub` is the id of the staff member using the app (embedded requests).
  const actorId = sessionToken?.sub ? String(sessionToken.sub) : null;

  return { admin, session, shop, actorId, redirect };
}
