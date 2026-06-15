import { describe, expect, it } from "vitest";

import { formatCampaignIcon, renderStatusBarAd } from "./status-bar-ad-renderer";

describe("status-bar-ad-renderer", () => {
  const allocation = {
    allocationId: "alloc-1",
    campaignId: "campaign-1",
    brand: "Ramp",
    iconUrl: "https://assets.ramp.com/icon.png",
    headline: "save time and money",
    destinationUrl: "https://ramp.com",
    cpmCents: 0,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };

  it("uses a placeholder codicon for advertiser-uploaded icon URLs", () => {
    expect(formatCampaignIcon("https://assets.ramp.com/icon.png")).toBe("$(file-media)");
  });

  it("renders brand, headline, and animated progress dots", () => {
    expect(renderStatusBarAd(allocation, 0)).toBe("$(file-media) Ramp · save time and money.");
    expect(renderStatusBarAd(allocation, 1)).toBe("$(file-media) Ramp · save time and money..");
    expect(renderStatusBarAd(allocation, 2)).toBe("$(file-media) Ramp · save time and money...");
    expect(renderStatusBarAd(allocation, 3)).toBe("$(file-media) Ramp · save time and money.");
  });
});
