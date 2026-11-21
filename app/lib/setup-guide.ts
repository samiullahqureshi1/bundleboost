/**
 * Home page "go live" steps. Completion is derived from real app state
 * wherever BundleBoost can observe it; only the theme-block step (which needs
 * theme access to detect) is confirmed by the merchant.
 */

export type SetupState = {
  totalCampaigns: number;
  liveCampaigns: number;
  /** Oldest DRAFT campaign, so the "go live" step can link straight to it. */
  firstDraftId: string | null;
  themeBlockConfirmed: boolean;
};

export type SetupStepId = "create" | "activate" | "theme";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  body: string;
  done: boolean;
  action: { label: string; href: string; external?: boolean };
  /** Only steps BundleBoost can't detect offer "I've done this". */
  manual: boolean;
};

export function buildSetupSteps(state: SetupState, themeEditorUrl: string): SetupStep[] {
  return [
    {
      id: "create",
      title: "Create a campaign",
      body: "Pick products and the discount for each quantity, like 5% off 2 and 10% off 4 or more.",
      done: state.totalCampaigns > 0,
      action: { label: "Create campaign", href: "/app/campaigns/new" },
      manual: false,
    },
    {
      id: "activate",
      title: "Turn it on at checkout",
      body: "Campaigns start as drafts. Activate one and Shopify applies it automatically.",
      done: state.liveCampaigns > 0,
      action: state.firstDraftId
        ? { label: "Review and activate", href: `/app/campaigns/${state.firstDraftId}` }
        : { label: "Go to campaigns", href: "/app/campaigns" },
      manual: false,
    },
    {
      id: "theme",
      title: "Add the block to your theme",
      body: "Shoppers see every tier on the product page, before they add to cart.",
      done: state.themeBlockConfirmed,
      action: { label: "Open theme editor", href: themeEditorUrl, external: true },
      manual: true,
    },
  ];
}

export function setupProgress(steps: SetupStep[]) {
  const completed = steps.filter((s) => s.done).length;
  return { completed, total: steps.length, allDone: completed === steps.length };
}
