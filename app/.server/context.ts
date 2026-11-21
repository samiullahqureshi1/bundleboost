import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { findShopByDomain, onShopAuthenticated } from "./services/shop.service";
import prisma from "../db.server";
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

  const isDocumentNavigation =
    request.headers.get("sec-fetch-dest") === "document" ||
    request.headers.get("sec-fetch-mode") === "navigate";

  // If this is a top-level document request without host/embedded context
  // (e.g. redirected back from a Shopify charge confirmation in the top-level window),
  // redirect the browser into the Shopify Admin embedded app URL.
  if (!host && !isEmbedded && isDocumentNavigation) {
    let shopDomain = url.searchParams.get("shop");
    if (!shopDomain) {
      try {
        const latestShop = await prisma.shop.findFirst({
          where: { uninstalledAt: null },
          orderBy: { updatedAt: "desc" },
        });
        shopDomain = latestShop?.domain ?? null;
      } catch {
        // DB fallback
      }
    }
    if (!shopDomain) {
      try {
        const latestSession = await prisma.session.findFirst({
          orderBy: { id: "desc" },
        });
        shopDomain = latestSession?.shop ?? null;
      } catch {
        // session fallback
      }
    }
    if (shopDomain) {
      const cleanShop = shopDomain.replace(/\.myshopify\.com$/, "");
      const apiKey = env().SHOPIFY_API_KEY;
      const adminPath = `${url.pathname}${url.search}`;
      throw redirect(
        `https://admin.shopify.com/store/${cleanShop}/apps/${apiKey}${adminPath}`,
      );
    }
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
