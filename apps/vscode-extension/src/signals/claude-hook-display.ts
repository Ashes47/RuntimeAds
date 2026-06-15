import type { AttentionRuntime } from "@runtimeads/runtime";

import { resolveDisplayAllocation } from "../rendering/resolve-display-allocation";
import type { ClaudeCodeWebviewService } from "../rendering/claude-code-webview-service";
import type { CodexWebviewService } from "../rendering/codex-webview-service";
import type { ClaudeCliSyncService } from "./claude-cli-sync";
import type { CodexCliSyncService } from "./codex-cli-sync";
import type { StatusBarService } from "../status-bar/status-bar-service";

let claudeCliSyncService: ClaudeCliSyncService | undefined;
let codexCliSyncService: CodexCliSyncService | undefined;
let claudeWebviewService: ClaudeCodeWebviewService | undefined;
let codexWebviewService: CodexWebviewService | undefined;
let statusBarService: StatusBarService | undefined;

export function registerClaudeCliSync(service: ClaudeCliSyncService): void {
  claudeCliSyncService = service;
}

export function registerCodexCliSync(service: CodexCliSyncService): void {
  codexCliSyncService = service;
}

export function registerDisplayWebviews(
  claude: ClaudeCodeWebviewService,
  codex: CodexWebviewService,
): void {
  claudeWebviewService = claude;
  codexWebviewService = codex;
}

export function registerStatusBar(service: StatusBarService): void {
  statusBarService = service;
}

async function refreshStatusBar(): Promise<void> {
  await statusBarService?.refresh();
}

export async function syncDisplaySurfacesFromRuntime(runtime: AttentionRuntime): Promise<void> {
  if (await runtime.getDisplayLifecycleService().isUserSuppressed()) {
    await refreshStatusBar();
    return;
  }

  await syncSpinnerMessageFromRuntime(runtime);

  const allocation = await resolveDisplayAllocation(runtime);
  if (!allocation) {
    await refreshStatusBar();
    return;
  }

  await Promise.all([
    claudeWebviewService?.applyCurrentAd(true),
    codexWebviewService?.applyCurrentAd(true),
  ]);
  await refreshStatusBar();
}

export async function syncSpinnerMessageFromRuntime(runtime: AttentionRuntime): Promise<void> {
  if (await runtime.getDisplayLifecycleService().isUserSuppressed()) {
    claudeCliSyncService?.clearCliSurfaces();
    codexCliSyncService?.clearBanner();
    return;
  }

  const waitingSession = runtime
    .getAgentDetectionService()
    .getSessions()
    .find((session) => session.state === "waiting" && !session.endedAt);
  const allocation = await resolveDisplayAllocation(runtime);
  if (!allocation) {
    return;
  }

  const lifecycle = runtime.getDisplayLifecycleService();
  const sessionId = waitingSession?.sessionId;

  if (claudeCliSyncService) {
    claudeCliSyncService.syncAllocation(allocation);
    await lifecycle.recordSurfaceDisplayed("cli_spinner_verb", allocation.allocationId, sessionId);
    await lifecycle.recordSurfaceDisplayed("cli_status_line", allocation.allocationId, sessionId);
  }

  if (codexCliSyncService) {
    const codexResult = codexCliSyncService.syncAllocation(allocation);
    if (codexResult.ok) {
      await lifecycle.recordSurfaceDisplayed(
        "codex_cli_banner",
        allocation.allocationId,
        sessionId,
      );
    }
  }

  await refreshStatusBar();
}

export async function clearSpinnerMessageFromRuntime(runtime: AttentionRuntime): Promise<void> {
  claudeCliSyncService?.clearCliSurfaces();
  codexCliSyncService?.clearBanner();
  await runtime.getDisplayLifecycleService().dismissCurrent("manual");
  await refreshStatusBar();
}

export async function restoreSpinnerMessageFromRuntime(runtime: AttentionRuntime): Promise<void> {
  await runtime.getDisplayLifecycleService().restoreUserDisplay();
  await syncSpinnerMessageFromRuntime(runtime);
}
