import { describe, expect, it } from "vitest";

import {
  containsLegacySpinnerImage,
  formatCliAdText,
  sanitizeSpinnerVerb,
} from "./terminal-spinner-renderer";

describe("terminal-spinner-renderer", () => {
  const allocation = {
    allocationId: "alloc-1",
    campaignId: "campaign-1",
    brand: "Linear",
    iconUrl: "https://linear.app/favicon.ico",
    headline: "Issue tracking built for speed",
    destinationUrl: "https://linear.app",
    cpmCents: 0,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };

  it("formats the verb as plain Kickbacks-style CLI text", () => {
    const verb = formatCliAdText(allocation);

    expect(verb).toBe("Linear — Issue tracking built for speed ↗");
    expect(verb).not.toContain("\u001b");
    expect(verb).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
  });

  it("strips legacy iTerm inline-image payloads from spinner verbs", () => {
    const legacy =
      "◆ \u001b]1337;File=inline=1;width=14;height=14;preserveAspectRatio=1:iVBORw0KGgo=\u0007 " +
      "\u001b[38;2;96;165;250mLinear\u001b[0m \u001b[38;2;147;197;253m — \u001b[0m " +
      "\u001b[38;2;96;165;250mIssue tracking built for speed\u001b[0m";

    expect(containsLegacySpinnerImage(legacy)).toBe(true);
    expect(sanitizeSpinnerVerb(legacy)).toContain("Linear");
    expect(sanitizeSpinnerVerb(legacy)).not.toContain("iVBORw0KGgo");
    expect(sanitizeSpinnerVerb(legacy)).not.toContain("1337;File");
  });
});
