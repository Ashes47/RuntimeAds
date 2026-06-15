import type { CachedAllocation } from "@runtimeads/sdk-contracts";

/** VS Code status bar text cannot embed remote images; use a placeholder codicon for URLs. */
export function formatCampaignIcon(iconUrl?: string): string {
  if (!iconUrl) {
    return "$(file-media)";
  }

  if (iconUrl.startsWith("$(")) {
    return iconUrl;
  }

  if (/^https?:\/\//i.test(iconUrl)) {
    return "$(file-media)";
  }

  return `$( ${iconUrl})`.replace("$( ", "$(");
}

export function renderStatusBarAd(allocation: CachedAllocation, progressFrame = 0): string {
  const icon = formatCampaignIcon(allocation.iconUrl);
  const dots = ".".repeat((progressFrame % 3) + 1);
  return `${icon} ${allocation.brand} · ${allocation.headline}${dots}`;
}
