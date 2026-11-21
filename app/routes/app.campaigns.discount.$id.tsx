import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../.server/context";
import prisma from "../db.server";

/**
 * Target of the Discount Function's `details` UI path: Shopify's Discounts
 * page links here with the automatic discount's numeric id. Resolves the
 * BundleBoost campaign that owns it (within the authenticated shop only).
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, redirect } = await requireAdmin(request);
  const numericId = (params.id ?? "").replace(/\D/g, "");
  const campaign = numericId
    ? await prisma.campaign.findFirst({
        where: {
          shopId: shop.id,
          shopifyDiscountId: `gid://shopify/DiscountAutomaticNode/${numericId}`,
        },
        select: { id: true },
      })
    : null;
  return redirect(campaign ? `/app/campaigns/${campaign.id}` : "/app/campaigns");
};
