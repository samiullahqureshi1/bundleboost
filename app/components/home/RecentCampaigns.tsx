import { Link } from "react-router";
import type { CampaignStatusValue, DiscountTypeValue } from "../../lib/campaign-validation";
import { formatTierSummary } from "../../lib/format";
import type { SyncStatusValue } from "../CampaignStatusBadge";

export type RecentCampaign = {
  id: string;
  name: string;
  status: CampaignStatusValue;
  syncStatus: SyncStatusValue;
  discountType: DiscountTypeValue;
  productCount: number;
  firstProductTitle: string | null;
  tiers: { minQuantity: number; value: string; label: string | null }[];
};

/** One short tag that says whether customers get this discount right now. */
function stateTag(c: RecentCampaign) {
  if (c.syncStatus === "ERROR") return { className: "bb-tag bb-tag--error", text: "Sync failed" };
  if (c.status === "ACTIVE" && c.syncStatus === "SYNCED") return { className: "bb-tag bb-tag--live", text: "Live" };
  if (c.status === "ACTIVE") return { className: "bb-tag bb-tag--paused", text: "Pending sync" };
  if (c.status === "PAUSED") return { className: "bb-tag bb-tag--paused", text: "Paused" };
  return { className: "bb-tag", text: "Draft" };
}

/** The most recently changed campaigns, each opening its editor. */
export function RecentCampaigns({
  campaigns,
  currencyCode,
}: {
  campaigns: RecentCampaign[];
  currencyCode: string | null;
}) {
  return (
    <div className="bb-glass bb-panel">
      <div className="bb-panel__head">
        <h3 className="bb-panel__title">Your campaigns</h3>
        <Link className="bb-link" to="/app/campaigns">
          View all
        </Link>
      </div>
      <ul className="bb-list">
        {campaigns.map((c) => {
          const tag = stateTag(c);
          return (
            <li key={c.id}>
              <Link className="bb-row" to={`/app/campaigns/${c.id}`}>
                <span style={{ minInlineSize: 0 }}>
                  <strong>{c.name}</strong>
                  <small>
                    {formatTierSummary(c.discountType, c.tiers, currencyCode)} · {c.productCount}{" "}
                    {c.productCount === 1 ? "product" : "products"}
                  </small>
                </span>
                <span className={tag.className}>{tag.text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
