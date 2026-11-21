import type { CampaignStatusValue } from "./campaign-validation";

export type SyncStatusValue = "NOT_SYNCED" | "SYNCED" | "ERROR";

/**
 * What a merchant needs to know about a campaign in one word: whether
 * customers get the discount right now, and if not, why.
 */
export function campaignState(status: CampaignStatusValue, syncStatus: SyncStatusValue) {
  if (syncStatus === "ERROR") return { key: "alert", label: "Sync failed" } as const;
  if (status === "ACTIVE" && syncStatus === "SYNCED") return { key: "live", label: "Live" } as const;
  if (status === "ACTIVE") return { key: "paused", label: "Pending sync" } as const;
  if (status === "PAUSED") return { key: "paused", label: "Paused" } as const;
  if (status === "ARCHIVED") return { key: "archived", label: "Archived" } as const;
  return { key: "draft", label: "Draft" } as const;
}
