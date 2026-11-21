import type { CampaignStatusValue } from "../lib/campaign-validation";
import { STATUS_LABEL, STATUS_TONE } from "../lib/format";

export type SyncStatusValue = "NOT_SYNCED" | "SYNCED" | "ERROR";

export function CampaignStatusBadge({ status }: { status: CampaignStatusValue }) {
  return <s-badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</s-badge>;
}

/**
 * Whether the campaign is actually applied at checkout, derived from the
 * campaign status and the state of its Shopify automatic discount.
 */
export function CheckoutSyncBadge({
  status,
  syncStatus,
}: {
  status: CampaignStatusValue;
  syncStatus: SyncStatusValue;
}) {
  if (syncStatus === "ERROR") {
    return (
      <s-badge tone="critical" icon="alert-triangle">
        Sync failed
      </s-badge>
    );
  }
  if (status === "ACTIVE" && syncStatus === "SYNCED") {
    return (
      <s-badge tone="success" icon="check">
        Live at checkout
      </s-badge>
    );
  }
  if (status === "ACTIVE") {
    return (
      <s-badge tone="warning" icon="clock">
        Pending sync
      </s-badge>
    );
  }
  return <s-badge tone="neutral">Not live at checkout</s-badge>;
}
