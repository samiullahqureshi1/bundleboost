import { describe, expect, it } from "vitest";
import { buildSetupSteps, setupProgress, type SetupState } from "../../app/lib/setup-guide";

const fresh: SetupState = {
  totalCampaigns: 0,
  liveCampaigns: 0,
  firstDraftId: null,
  themeBlockConfirmed: false,
};

describe("buildSetupSteps", () => {
  it("starts with nothing done and create-campaign as the first action", () => {
    const steps = buildSetupSteps(fresh, "https://editor");
    expect(steps.map((s) => s.id)).toEqual(["create", "activate", "theme"]);
    expect(setupProgress(steps)).toEqual({ completed: 0, total: 3, allDone: false });
    expect(steps[0].action.href).toBe("/app/campaigns/new");
  });

  it("derives completion from real state, and only the theme step is manual", () => {
    const steps = buildSetupSteps({ ...fresh, totalCampaigns: 2, liveCampaigns: 1 }, "https://editor");
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(["create", "activate"]);
    expect(steps.filter((s) => s.manual).map((s) => s.id)).toEqual(["theme"]);
  });

  it("does not count a draft as live and links straight to it", () => {
    const steps = buildSetupSteps({ ...fresh, totalCampaigns: 1, firstDraftId: "c1" }, "x");
    expect(steps.find((s) => s.id === "activate")).toMatchObject({
      done: false,
      action: { label: "Review and activate", href: "/app/campaigns/c1" },
    });
  });

  it("opens the theme editor outside the app frame", () => {
    const theme = buildSetupSteps(fresh, "https://shop/admin/themes/current/editor").find((s) => s.id === "theme")!;
    expect(theme.action).toEqual({ label: "Open theme editor", href: "https://shop/admin/themes/current/editor", external: true });
  });

  it("reports all done when every step is complete", () => {
    const steps = buildSetupSteps(
      { totalCampaigns: 1, liveCampaigns: 1, firstDraftId: null, themeBlockConfirmed: true },
      "x",
    );
    expect(setupProgress(steps).allDone).toBe(true);
  });
});
