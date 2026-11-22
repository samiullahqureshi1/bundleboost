import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { env } from "../.server/env";
import { isAuthorizedJobRequest } from "../.server/jobs-auth";
import { logger } from "../.server/logger";
import { runRenewals, shopsWithDueRenewals } from "../.server/services/subscription-contract.service";
import { unauthenticated } from "../shopify.server";

/**
 * Hourly renewal job. Charges every due subscription renewal and retry
 * across all shops. Safe to call more often: cycles with a charge in
 * progress or already billed are not charged again.
 *
 *  - Vercel Cron (vercel.json) calls GET /jobs/renewals with
 *    "Authorization: Bearer $CRON_SECRET".
 *  - Any other scheduler can POST with "Authorization: Bearer $JOBS_SECRET".
 */
// Vercel function settings for this route (read by the Vercel preset):
// enough time to charge renewals for many shops in one run.
export const config = { maxDuration: 300 };

async function runJob(request: Request) {
  const { CRON_SECRET, JOBS_SECRET } = env();
  if (!isAuthorizedJobRequest(request, [CRON_SECRET, JOBS_SECRET])) {
    return new Response(null, { status: 401 });
  }

  const shops = await shopsWithDueRenewals();
  const results: { shop: string; charged?: number; advanced?: number; failed?: number; error?: string }[] = [];
  for (const shop of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop.domain);
      results.push({ shop: shop.domain, ...(await runRenewals(admin, shop.shopId)) });
    } catch (error) {
      logger.error("Renewal job failed for shop", { shop: shop.domain, error });
      results.push({ shop: shop.domain, error: "failed" });
    }
  }
  logger.info("Renewal job finished", { shops: results.length });
  return Response.json({ shops: results.length, results });
}

export const loader = ({ request }: LoaderFunctionArgs) => runJob(request);

export const action = ({ request }: ActionFunctionArgs) =>
  request.method === "POST" ? runJob(request) : new Response(null, { status: 405 });
