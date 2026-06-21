/** Maps internal technical strings to user-facing copy. */

import { surfaceLabel } from "@runtimeads/sdk-contracts";

const REASON_MAP: Record<string, string> = {
  "Claude Code webview bundle not found":
    "Claude Code extension not found — install Anthropic's Claude Code extension and reload.",
  "Unable to read Claude Code webview bundle":
    "Could not read Claude Code — try reloading the window.",
  "Unsupported Claude Code build (spinner markers missing)":
    "Your Claude Code version is not supported yet — update the Claude Code extension.",
  "Claude Code bundle modified (anchors missing while patched)":
    "Claude Code looks modified by another tool — reinstall the Claude Code extension, then reload.",
  "Claude Code panel has not been patched yet":
    "Sponsor ads are not set up in the Claude panel yet — run Set Up Claude & Codex.",
  "Claude Code extension not found":
    "Claude Code extension not found — install Anthropic's Claude Code extension and reload.",
  "Codex webview bundle not found":
    "Codex extension not found — install OpenAI's Codex extension and reload.",
  "Unable to read Codex webview bundle": "Could not read Codex — try reloading the window.",
  "Unsupported Codex build (thinking-shimmer anchors missing)":
    "Your Codex version is not supported yet — update the Codex extension.",
  "Codex bundle modified (anchors missing while patched)":
    "Codex looks modified by another tool — reinstall the Codex extension, then reload.",
  "Codex panel has not been patched yet":
    "Sponsor ads are not set up in the Codex panel yet — run Set Up Claude & Codex.",
  "Codex extension not found":
    "Codex extension not found — install OpenAI's Codex extension and reload.",
  "codex shim not found": "Codex CLI integration is not set up — run Set Up Claude & Codex.",
  "No active sponsor allocation": "No sponsor ad available right now.",
  allocation_already_verified: "This ad was already counted.",
  allocation_click_already_verified: "This ad click was already counted.",
  session_double_count: "This wait session already counted an ad (legacy rejection).",
  duplicate: "This ad event was already counted.",
};

export function formatTechnicalReason(reason: string): string {
  return REASON_MAP[reason] ?? reason;
}

export function formatPreflightIssue(surface: string, reason: string): string {
  const friendly = formatTechnicalReason(reason);
  // Shared surface names (same wording the web dashboard shows). `surface` is a render-surface code.
  return `${surfaceLabel(surface)}: ${friendly}`;
}

export function formatAuthStatus(status: string): string {
  switch (status) {
    case "authenticated":
      return "Signed in";
    case "unauthenticated":
      return "Not signed in";
    default:
      return status;
  }
}

export function formatHealthStatus(health: string): string {
  switch (health) {
    case "healthy":
      return "Working";
    case "degraded":
      return "Needs attention";
    case "unhealthy":
      return "Not working";
    default:
      return health;
  }
}

export function formatSyncStatus(status: string | undefined): string {
  switch (status) {
    case "idle":
      return "Up to date";
    case "syncing":
      return "Syncing…";
    case "error":
      return "Sync failed";
    default:
      return status ?? "Unknown";
  }
}

export function formatNetworkStatus(status: string | undefined): string {
  switch (status) {
    case "online":
      return "Online";
    case "offline":
      return "Offline";
    default:
      return status ?? "Unknown";
  }
}
