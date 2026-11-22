import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { AppError, ValidationError } from "../.server/errors";
import { logger } from "../.server/logger";
import { findShopByDomain } from "../.server/services/shop.service";
import {
  listPortalSubscriptions,
  parsePortalAction,
  runPortalAction,
  type PortalCustomer,
} from "../.server/services/subscription-portal.service";
import { authenticate, unauthenticated } from "../shopify.server";

/**
 * Backend for the "My subscriptions" customer account page.
 *
 *   GET  /api/portal/subscriptions  → the signed-in customer's subscriptions
 *   POST /api/portal/subscriptions  → { contractId, action, frequencyId? }
 *
 * Called from the customer account extension with Shopify's session token
 * (verified here); the customer and shop come only from that token.
 */

type Cors = (response: Response) => Response;

function shopDomain(dest: unknown) {
  const value = String(dest ?? "");
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return "";
  }
}

async function portalCustomer(request: Request): Promise<{ ctx: PortalCustomer | null; cors: Cors }> {
  // Answers CORS preflight (OPTIONS) itself and rejects invalid tokens.
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const customerGid = typeof sessionToken.sub === "string" ? sessionToken.sub : "";
  const domain = shopDomain(sessionToken.dest);
  const shop = domain ? await findShopByDomain(domain) : null;
  if (!shop || shop.uninstalledAt || !customerGid.startsWith("gid://shopify/Customer/")) {
    return { ctx: null, cors };
  }
  const { admin } = await unauthenticated.admin(domain);
  return { ctx: { shopId: shop.id, customerGid, admin }, cors };
}

function failure(error: unknown, cors: Cors) {
  if (error instanceof Response) throw error;
  if (error instanceof AppError) {
    const message =
      error instanceof ValidationError ? Object.values(error.fieldErrors)[0] ?? error.message : error.message;
    return cors(Response.json({ ok: false, message }, { status: error.status }));
  }
  logger.error("Subscription portal error", { error });
  return cors(Response.json({ ok: false, message: "Something went wrong. Please try again." }, { status: 500 }));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { ctx, cors } = await portalCustomer(request);
  if (!ctx) return cors(Response.json({ ok: true, subscriptions: [] }));
  try {
    return cors(Response.json({ ok: true, subscriptions: await listPortalSubscriptions(ctx) }));
  } catch (error) {
    return failure(error, cors);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { ctx, cors } = await portalCustomer(request);
  if (request.method !== "POST") return cors(new Response(null, { status: 405 }));
  if (!ctx) return cors(Response.json({ ok: false, message: "Please sign in again." }, { status: 401 }));
  try {
    const body = await request.json().catch(() => null);
    const subscription = await runPortalAction(ctx, parsePortalAction(body));
    return cors(Response.json({ ok: true, subscription }));
  } catch (error) {
    return failure(error, cors);
  }
};
