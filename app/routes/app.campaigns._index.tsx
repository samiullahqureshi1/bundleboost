import { useEffect, useRef } from "react";
import {
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { findCampaign, listCampaigns } from "../.server/repositories/campaign.repository";
import { changeCampaignStatus, deleteCampaign } from "../.server/services/campaign.service";
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, actorId, admin } = await requireAdmin(request);
  const ctx = { shopId: shop.id, actorId, admin };

  let body: { intent?: string; ids?: string[]; status?: CampaignStatusValue };
  try {
    body = await request.json();
  } catch {
    return { ok: false, message: "Invalid request payload" };
  }

  const { intent, ids, status } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, message: "No campaigns selected" };
  }

  if (intent === "bulk_status") {
    if (!status || !CAMPAIGN_STATUSES.includes(status)) {
      return { ok: false, message: "Invalid status requested" };
    }

    let successCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const campaign = await findCampaign(shop.id, id);
        if (!campaign) continue;

        if (campaign.status === status) {
          successCount++;
          continue;
        }

        if (status === "ACTIVE") {
          if (campaign.status === "ARCHIVED") {
            await changeCampaignStatus(ctx, id, "DRAFT");
          }
          await changeCampaignStatus(ctx, id, "ACTIVE");
          successCount++;
        } else if (status === "PAUSED") {
          if (campaign.status === "ACTIVE") {
            await changeCampaignStatus(ctx, id, "PAUSED");
            successCount++;
          } else {
            errors.push(`"${campaign.name}" must be active before it can be paused`);
          }
        } else if (status === "ARCHIVED") {
          await changeCampaignStatus(ctx, id, "ARCHIVED");
          successCount++;
        }
      } catch (err: unknown) {
        errors.push(err instanceof Error ? err.message : "Failed to update campaign");
      }
    }

    if (errors.length > 0 && successCount === 0) {
      return { ok: false, message: errors[0] };
    }

    const verb =
      status === "ACTIVE" ? "activated" : status === "PAUSED" ? "paused" : "archived";
    const msg =
      errors.length > 0
        ? `${successCount} ${successCount === 1 ? "campaign" : "campaigns"} ${verb} (${errors.length} failed: ${errors[0]})`
        : `${successCount} ${successCount === 1 ? "campaign" : "campaigns"} ${verb}`;

    return { ok: true, message: msg };
  }

  if (intent === "bulk_delete") {
    let successCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const campaign = await findCampaign(shop.id, id);
        if (!campaign) continue;

        if (campaign.status === "ACTIVE" || campaign.status === "PAUSED") {
          await changeCampaignStatus(ctx, id, "ARCHIVED");
        }

        await deleteCampaign(ctx, id);
        successCount++;
      } catch (err: unknown) {
        errors.push(err instanceof Error ? err.message : "Failed to delete campaign");
      }
    }

    if (errors.length > 0 && successCount === 0) {
      return { ok: false, message: errors[0] };
    }

    const msg =
      errors.length > 0
        ? `${successCount} ${successCount === 1 ? "campaign" : "campaigns"} deleted (${errors.length} failed: ${errors[0]})`
        : `${successCount} ${successCount === 1 ? "campaign" : "campaigns"} deleted`;

    return { ok: true, message: msg };
  }

  return { ok: false, message: "Unknown action" };
};

export default function Campaigns() {
  const { campaigns, currencyCode, initialTab } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const remover = useFetcher();
  const bulkFetcher = useFetcher();

  const deleting = remover.state !== "idle";
  const isBulkBusy = bulkFetcher.state !== "idle";
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

  // Bulk action response notification
  useEffect(() => {
    if (bulkFetcher.state === "idle" && bulkFetcher.data) {
      const data = bulkFetcher.data as { ok: boolean; message: string };
      if (data.message) {
        shopify.toast.show(data.message, { isError: !data.ok });
      }
    }
  }, [bulkFetcher.state, bulkFetcher.data, shopify]);

  return (
    <CampaignsView
      campaigns={campaigns}
      currencyCode={currencyCode}
      initialTab={initialTab}
      deleting={deleting}
      isBulkBusy={isBulkBusy}
      onDelete={(campaign) => {
        pending.current = campaign.id;
        remover.submit(
          { intent: "delete" },
          { method: "post", action: `/app/campaigns/${campaign.id}`, encType: "application/json" },
        );
      }}
      onBulkStatus={(ids, status) => {
        bulkFetcher.submit(
          { intent: "bulk_status", ids, status },
          { method: "post", encType: "application/json" },
        );
      }}
      onBulkDelete={(ids) => {
        bulkFetcher.submit(
          { intent: "bulk_delete", ids },
          { method: "post", encType: "application/json" },
        );
      }}
    />
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
