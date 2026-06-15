import type { CachedAllocation, RuntimeStatus } from "@runtimeads/sdk-contracts";
import { renderStatusBarAd, type AttentionRuntime } from "@runtimeads/runtime";

import { ensurePatchAllocation } from "../rendering/resolve-display-allocation";
import type { ClaudeCodeWebviewService } from "../rendering/claude-code-webview-service";
import type { CodexWebviewService } from "../rendering/codex-webview-service";
import type { ClaudeCliSyncService } from "../signals/claude-cli-sync";
import { openUrlInSystemBrowser } from "../signals/open-system-browser";
import type { ExtensionContext, StatusBarItem } from "vscode";
import { StatusBarAlignment, window, workspace } from "vscode";

const BACKGROUND_RETRY_MS = 30_000;

export class StatusBarService {
  private readonly item: StatusBarItem;
  private animationFrame = 0;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
  private activeAllocation: CachedAllocation | undefined;
  private statusBarAdVisibleSinceMs: number | undefined;
  private statusBarAdAllocationId: string | undefined;
  private statusBarAdSessionId: string | undefined;
  private lastSyncAttemptMs = 0;
  private lastRefillAttemptMs = 0;

  constructor(
    private readonly runtime: AttentionRuntime,
    private readonly claudeWebviewService?: ClaudeCodeWebviewService,
    private readonly codexWebviewService?: CodexWebviewService,
    private readonly claudeCliSyncService?: ClaudeCliSyncService,
  ) {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    this.item.command = "runtimeads.openMenu";
    this.item.tooltip = "RuntimeAds — click for menu";
  }

  start(context: ExtensionContext): void {
    context.subscriptions.push(this.item);
    context.subscriptions.push(
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("runtimeads")) {
          void this.refresh();
        }
      }),
    );

    this.animationTimer = setInterval(() => {
      this.animationFrame += 1;
      this.updateStatusBarAnimation();
    }, 500);
    void this.refresh();
    this.item.show();
  }

  stop(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = undefined;
    }
    void this.flushStatusBarVisibility();
  }

  async refresh(): Promise<void> {
    const status = this.runtime.getStatus();

    if (status.authStatus !== "authenticated") {
      await this.showRuntimeStatus(this.offlineLabel(status));
      return;
    }

    await this.maybeRetryBackgroundSync(status);
    await this.maybeRetryInventoryRefill(status);
    await this.ensureWaitingSessionPinned();

    if (this.isWaitingForAgent() && this.isTerminalAgentWaiting()) {
      await this.syncTerminalAdSurfaces();
    }

    await this.renderAuthenticatedStatus(status);
  }

  private updateStatusBarAnimation(): void {
    if (!this.activeAllocation || !this.statusBarAdsEnabled()) {
      return;
    }

    this.item.text = renderStatusBarAd(this.activeAllocation, this.animationFrame);
  }

  private async ensureWaitingSessionPinned(): Promise<void> {
    if (!this.isWaitingForAgent()) {
      return;
    }

    const waitingSession = this.runtime
      .getAgentDetectionService()
      .getSessions()
      .find((session) => session.state === "waiting" && !session.endedAt);
    if (waitingSession?.sessionId) {
      await this.runtime.getDisplayLifecycleService().beginWaitingSession(waitingSession.sessionId);
    }
  }

  private async renderAuthenticatedStatus(status: RuntimeStatus): Promise<void> {
    const waiting = this.isWaitingForAgent();
    await this.runtime.getDisplayLifecycleService().clearUserSuppressIfIdle(!waiting);

    if (await this.runtime.getDisplayLifecycleService().isUserSuppressed()) {
      await this.showRuntimeStatus(
        "Ads dismissed",
        "Use RuntimeAds → Restore sponsor ads to show them again.",
      );
      return;
    }

    if (!this.statusBarAdsEnabled()) {
      await this.showRuntimeStatus("Connected", this.buildSyncDetail(status));
      return;
    }

    if (!waiting) {
      if (this.activeAllocation) {
        await this.flushStatusBarVisibility();
        this.activeAllocation = undefined;
      }
      await this.showRuntimeStatus("Connected", this.buildSyncDetail(status));
      return;
    }

    const resolvedAllocation = await ensurePatchAllocation(this.runtime);
    if (
      this.activeAllocation &&
      resolvedAllocation &&
      this.activeAllocation.allocationId !== resolvedAllocation.allocationId
    ) {
      await this.flushStatusBarVisibility();
    }

    this.activeAllocation = resolvedAllocation;

    if (!this.activeAllocation) {
      const label =
        status.syncStatus === "syncing"
          ? "Syncing"
          : status.cacheSize === 0
            ? "Loading ads"
            : "Connected";
      await this.showRuntimeStatus(
        label,
        this.buildSyncDetail(status) ?? "No sponsor ads loaded yet",
      );
      return;
    }

    if (
      this.statusBarAdAllocationId &&
      this.statusBarAdAllocationId !== this.activeAllocation.allocationId
    ) {
      await this.flushStatusBarVisibility();
    }

    this.updateStatusBarAnimation();
    this.item.command = "runtimeads.openActiveAd";
    this.item.tooltip = this.buildAdTooltip(this.activeAllocation, status);

    if (!this.statusBarAdVisibleSinceMs) {
      this.statusBarAdVisibleSinceMs = Date.now();
      this.statusBarAdAllocationId = this.activeAllocation.allocationId;
      this.statusBarAdSessionId = this.runtime
        .getAgentDetectionService()
        .getSessions()
        .find((session) => session.state === "waiting" && !session.endedAt)?.sessionId;
    }
  }

  private statusBarAdsEnabled(): boolean {
    return workspace.getConfiguration("runtimeads").get<boolean>("render.statusBarAds", true);
  }

  private buildAdTooltip(allocation: CachedAllocation, status: RuntimeStatus): string {
    const syncDetail = this.buildSyncDetail(status);
    const adLine = `${allocation.brand} · ${allocation.headline} — click to open`;
    return syncDetail ? `${adLine} · ${syncDetail}` : adLine;
  }

  private buildSyncDetail(status: RuntimeStatus): string | undefined {
    if (status.syncStatus === "error") {
      return `Could not sync earnings data (${status.queueSize} pending): ${status.lastError ?? "unknown"}`;
    }

    if (status.syncStatus === "syncing") {
      return status.queueSize > 0 ? `Syncing ${status.queueSize} items…` : "Syncing earnings data…";
    }

    if (status.queueSize > 0) {
      if (status.lastError) {
        return `${status.queueSize} items pending upload: ${status.lastError}`;
      }
      return `${status.queueSize} items pending upload`;
    }

    return undefined;
  }

  private async maybeRetryBackgroundSync(status: RuntimeStatus): Promise<void> {
    if (status.queueSize === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastSyncAttemptMs < BACKGROUND_RETRY_MS) {
      return;
    }

    this.lastSyncAttemptMs = now;
    try {
      await this.runtime.getSyncEngine().flush();
    } catch {
      // Errors are recorded on the runtime; tooltip will surface lastError.
    }
  }

  private async maybeRetryInventoryRefill(status: RuntimeStatus): Promise<void> {
    if (status.cacheSize >= 5) {
      return;
    }

    const now = Date.now();
    if (now - this.lastRefillAttemptMs < BACKGROUND_RETRY_MS) {
      return;
    }

    this.lastRefillAttemptMs = now;
    try {
      await this.runtime.refillInventoryIfNeeded();
    } catch {
      // Refill errors are recorded on the runtime.
    }
  }

  private offlineLabel(status: RuntimeStatus): string {
    return status.health === "healthy" ? "Sign in" : "Offline";
  }

  private isWaitingForAgent(): boolean {
    return this.runtime
      .getAgentDetectionService()
      .getSessions()
      .some((session) => session.state === "waiting" && !session.endedAt);
  }

  private isTerminalAgentWaiting(): boolean {
    return this.runtime
      .getAgentDetectionService()
      .getSessions()
      .some(
        (session) =>
          (session.agent === "claude_code" || session.agent === "codex_cli") &&
          session.state === "waiting" &&
          !session.endedAt,
      );
  }

  private async syncTerminalAdSurfaces(): Promise<void> {
    if (await this.runtime.getDisplayLifecycleService().isUserSuppressed()) {
      this.claudeCliSyncService?.clearCliSurfaces();
      return;
    }

    const allocation = await ensurePatchAllocation(this.runtime);
    if (!allocation) {
      return;
    }

    this.claudeCliSyncService?.syncAllocation(allocation);
    await Promise.all([
      this.claudeWebviewService?.applyCurrentAd(),
      this.codexWebviewService?.applyCurrentAd(),
    ]);
  }

  private async showRuntimeStatus(label: string, detail?: string): Promise<void> {
    await this.flushStatusBarVisibility();
    this.activeAllocation = undefined;
    this.item.text = `RuntimeAds: ${label}`;
    this.item.command = "runtimeads.openMenu";
    this.item.tooltip = detail ? `RuntimeAds — ${detail}` : "RuntimeAds — click for menu";
  }

  private async flushStatusBarVisibility(): Promise<void> {
    if (!this.statusBarAdVisibleSinceMs || !this.statusBarAdAllocationId) {
      this.statusBarAdVisibleSinceMs = undefined;
      this.statusBarAdAllocationId = undefined;
      this.statusBarAdSessionId = undefined;
      return;
    }

    const visibleMs = Date.now() - this.statusBarAdVisibleSinceMs;
    await this.runtime
      .getDisplayLifecycleService()
      .reportSurfaceVisibility(
        "vscode_status_bar",
        this.statusBarAdAllocationId,
        visibleMs,
        this.statusBarAdSessionId,
      );

    this.statusBarAdVisibleSinceMs = undefined;
    this.statusBarAdAllocationId = undefined;
    this.statusBarAdSessionId = undefined;
  }

  async openActiveAd(): Promise<void> {
    if (!this.activeAllocation?.destinationUrl) {
      return;
    }

    const waitingSession = this.runtime
      .getAgentDetectionService()
      .getSessions()
      .find((session) => session.state === "waiting" && !session.endedAt);
    const sessionId = this.statusBarAdSessionId ?? waitingSession?.sessionId;

    await this.runtime
      .getDisplayLifecycleService()
      .recordSurfaceDisplayed("vscode_status_bar", this.activeAllocation.allocationId, sessionId);
    await this.runtime
      .getDisplayLifecycleService()
      .recordClick("vscode_status_bar", this.activeAllocation.allocationId, sessionId);
    await this.runtime.getSyncEngine().flush();
    await openUrlInSystemBrowser(this.activeAllocation.destinationUrl);
  }
}
