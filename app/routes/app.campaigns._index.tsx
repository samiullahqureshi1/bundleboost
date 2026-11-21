import { useEffect, useRef } from "react";
import {
  useFetcher,
  useLoaderData,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { listCampaigns } from "../.server/repositories/campaign.repository";
import { CampaignsView } from "../components/campaigns/CampaignsView";
import { RouteError } from "../components/RouteError";
import { CAMPAIGN_STATUSES, type CampaignStatusValue } from "../lib/campaign-validation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const statusParam = new URL(request.url).searchParams.get("status");
  const initialTab = CAMPAIGN_STATUSES.includes(statusParam as CampaignStatusValue)
    ? (statusParam as CampaignStatusValue)
    : ("ALL" as const);

  // Every campaign, archived included, so each status tab shows its count.
  const campaigns = await listCampaigns(shop.id, { includeArchived: true });
  return {
    initialTab,
    currencyCode: shop.currencyCode,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      discountType: c.discountType,
      syncStatus: c.syncStatus,
      productCount: c._count.products,
      productTitles: c.products.map((p) => p.title),
      tiers: c.tiers.map((t) => ({ minQuantity: t.minQuantity, value: t.value.toString() })),
      updatedAt: c.updatedAt.toISOString(),
    })),
  };
};

export default function Campaigns() {
  const { campaigns, currencyCode, initialTab } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const remover = useFetcher();
  const deleting = remover.state !== "idle";
  const pending = useRef<string | null>(null);

  // Delete through the campaign's own action (it removes any Shopify
  // discount first), then report once the list has reloaded.
  useEffect(() => {
    if (deleting || !pending.current) return;
    const stillThere = campaigns.some((c) => c.id === pending.current);
    pending.current = null;
    (document.getElementById("delete-campaign-modal") as (HTMLElement & { hideOverlay?: () => void }) | null)?.hideOverlay?.();
    shopify.toast.show(stillThere ? "Couldn't delete the campaign. Try again." : "Campaign deleted", {
      isError: stillThere,
    });
  }, [deleting, campaigns, shopify]);

  return (
    <CampaignsView
      campaigns={campaigns}
      currencyCode={currencyCode}
      initialTab={initialTab}
      deleting={deleting}
      onDelete={(campaign) => {
        pending.current = campaign.id;
        remover.submit(
          { intent: "delete" },
          { method: "post", action: `/app/campaigns/${campaign.id}`, encType: "application/json" },
        );
      }}
    />
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
