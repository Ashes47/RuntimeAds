import type {
  CachedAllocation,
  InventoryDismissReason,
  RenderSurface,
} from "@runtimeads/sdk-contracts";

import type { CacheStore } from "../cache/cache-store";
import { InventorySelector } from "../inventory/inventory-selector";
import type { DisplayEventService } from "./display-event-service";
import type { DisplayMetricsService } from "./display-metrics-service";
import { FrequencyGuard } from "./frequency-guard";

export const DISPLAY_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
/** Minimum cumulative visible time before a surface counts as one impression. */
export const IMPRESSION_VIEW_THRESHOLD_MS = 5000;
/** Unified surface priority for attributing the single session impression. */
export const IMPRESSION_SURFACE_PRIORITY: RenderSurface[] = [
  "claude_overlay",
  "codex_overlay",
  "cli_spinner_verb",
  "cli_status_line",
  "codex_cli_banner",
  "vscode_status_bar",
];

export type DisplaySessionState = "pending" | "visible" | "dismissed" | "completed";

export interface DisplayLifecycleSession {
  sessionId: string;
  allocation: CachedAllocation;
  surfacesDisplayed: Set<RenderSurface>;
  surfaceVisibilityMs: Map<RenderSurface, number>;
  impressionRecorded: boolean;
  state: DisplaySessionState;
  visibleSinceMs?: number;
}

export interface RecordImpressionOptions {
  visibleMs?: number;
}

export interface CompleteWaitingSessionOptions {
  waitingPeriodMs?: number;
}

export interface DisplayLifecycleServiceOptions {
  cacheStore: CacheStore;
  displayEvents: DisplayEventService;
  frequencyGuard: FrequencyGuard;
  displayMetrics?: DisplayMetricsService;
  sessionTimeoutMs?: number;
  now?: () => number;
}

export class DisplayLifecycleService {
  private readonly selector: InventorySelector;
  private readonly sessionTimeoutMs: number;
  private readonly now: () => number;
  private activeSession: DisplayLifecycleSession | undefined;
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: DisplayLifecycleServiceOptions) {
    this.selector = new InventorySelector(options.cacheStore);
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DISPLAY_SESSION_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  getCurrentAllocation(): CachedAllocation | undefined {
    return this.activeSession?.allocation;
  }

  getSessionState(): DisplaySessionState | "idle" {
    return this.activeSession?.state ?? "idle";
  }

  async isUserSuppressed(): Promise<boolean> {
    return this.options.frequencyGuard.isUserSuppressed();
  }

  async clearUserSuppressIfIdle(isAnyAgentWaiting: boolean): Promise<void> {
    if (!isAnyAgentWaiting) {
      await this.options.frequencyGuard.clearUserSuppress();
    }
  }

  async restoreUserDisplay(): Promise<void> {
    await this.options.frequencyGuard.clearUserSuppress();
  }

  async resolveAllocationForDisplay(sessionId?: string): Promise<CachedAllocation | undefined> {
    if (!(await this.options.frequencyGuard.canRender())) {
      this.options.displayMetrics?.recordImpressionSkip("frequency_cap");
      return undefined;
    }

    if (this.activeSession) {
      return this.activeSession.allocation;
    }

    if (!sessionId) {
      return undefined;
    }

    const allocation = await this.selector.selectNext();
    if (!allocation) {
      this.options.displayMetrics?.recordEmptyCache();
      this.options.displayMetrics?.recordImpressionSkip("empty_cache");
      return undefined;
    }

    this.activeSession = {
      sessionId,
      allocation,
      surfacesDisplayed: new Set(),
      surfaceVisibilityMs: new Map(),
      impressionRecorded: false,
      state: "pending",
    };
    this.options.displayMetrics?.setSessionState("pending");

    return allocation;
  }

  async beginWaitingSession(sessionId: string): Promise<CachedAllocation | undefined> {
    if (this.activeSession && this.activeSession.sessionId !== sessionId) {
      await this.abandonActiveSession("waiting_ended");
    }

    return this.resolveAllocationForDisplay(sessionId);
  }

  async recordSurfaceDisplayed(
    surface: RenderSurface,
    allocationId: string,
    sessionId?: string,
  ): Promise<void> {
    const session = await this.resolveSurfaceSession(sessionId, allocationId);
    if (!session) {
      return;
    }

    const allocation = session.allocation;
    if (session.surfacesDisplayed.has(surface)) {
      return;
    }

    session.surfacesDisplayed.add(surface);
    await this.markVisible(session);
    await this.options.cacheStore.markDisplayed(allocation.allocationId);
    await this.options.displayEvents.recordInventoryDisplayed(
      allocation,
      surface,
      session.sessionId,
    );
    this.options.displayMetrics?.recordInventoryDisplay();
  }

  async reportSurfaceVisibility(
    surface: RenderSurface,
    allocationId: string,
    visibleMs: number,
    sessionId?: string,
  ): Promise<void> {
    const session = await this.resolveSurfaceSession(sessionId, allocationId);
    if (!session) {
      return;
    }
    const current = session.surfaceVisibilityMs.get(surface) ?? 0;
    if (visibleMs <= current) {
      return;
    }

    session.surfaceVisibilityMs.set(surface, visibleMs);
    await this.tryRecordSessionImpression(session);
  }

  async recordImpression(
    surface: RenderSurface,
    allocationId: string,
    sessionId?: string,
    options?: RecordImpressionOptions,
  ): Promise<void> {
    const visibleMs = options?.visibleMs;
    if (visibleMs === undefined) {
      return;
    }

    await this.reportSurfaceVisibility(surface, allocationId, visibleMs, sessionId);
  }

  async recordClick(
    surface: RenderSurface,
    allocationId: string,
    sessionId?: string,
  ): Promise<void> {
    const sessionIdResolved = sessionId ?? this.activeSession?.sessionId;
    await this.options.displayEvents.recordRenderClick(allocationId, surface, sessionIdResolved);
  }

  async dismissCurrent(reason: InventoryDismissReason = "manual"): Promise<void> {
    const session = this.activeSession;
    if (session) {
      await this.options.displayEvents.recordInventoryDismissed(
        session.allocation.allocationId,
        reason,
        session.sessionId,
      );
      this.finalizeVisibleDuration(session);
      session.state = "dismissed";
      this.options.displayMetrics?.setSessionState("dismissed");
      this.options.displayMetrics?.recordDismissal();
      if (reason === "timeout") {
        this.options.displayMetrics?.recordLifecycleTimeout();
      }
    }

    this.clearSessionTimeout();
    if (reason === "manual") {
      await this.options.frequencyGuard.dismissForSession();
    } else {
      await this.options.frequencyGuard.endSession();
    }
    this.activeSession = undefined;
    this.options.displayMetrics?.setSessionState("idle");
  }

  async completeWaitingSession(
    sessionId?: string,
    options?: CompleteWaitingSessionOptions,
  ): Promise<void> {
    let session = this.activeSession;
    if (!session && sessionId && (options?.waitingPeriodMs ?? 0) >= IMPRESSION_VIEW_THRESHOLD_MS) {
      await this.beginWaitingSession(sessionId);
      session = this.activeSession;
    }

    if (!session) {
      if ((options?.waitingPeriodMs ?? 0) >= IMPRESSION_VIEW_THRESHOLD_MS) {
        this.options.displayMetrics?.recordImpressionSkip("no_display_session");
      }
      await this.options.frequencyGuard.endSession();
      return;
    }

    if (sessionId && session.sessionId !== sessionId) {
      await this.abandonActiveSession("waiting_ended");
      if ((options?.waitingPeriodMs ?? 0) >= IMPRESSION_VIEW_THRESHOLD_MS) {
        await this.beginWaitingSession(sessionId);
        session = this.activeSession;
      }
      if (!session || (sessionId && session.sessionId !== sessionId)) {
        this.options.displayMetrics?.recordImpressionSkip("session_mismatch");
        return;
      }
    }

    await this.tryRecordSessionImpression(session, options?.waitingPeriodMs);

    await this.options.displayEvents.recordInventoryDismissed(
      session.allocation.allocationId,
      "waiting_ended",
      session.sessionId,
    );
    this.finalizeVisibleDuration(session);
    session.state = "completed";
    this.options.displayMetrics?.setSessionState("completed");
    this.options.displayMetrics?.recordDismissal();
    await this.options.cacheStore.markConsumed(session.allocation.allocationId);
    await this.options.frequencyGuard.recordRender();
    await this.options.frequencyGuard.endSession();
    this.clearSessionTimeout();
    this.activeSession = undefined;
    this.options.displayMetrics?.setSessionState("idle");
  }

  async purgeExpiredAllocations(): Promise<number> {
    const expired = await this.options.cacheStore.expireStale();
    for (const entry of expired) {
      const allocation = entry.value as CachedAllocation;
      if (allocation?.allocationId) {
        await this.options.displayEvents.recordInventoryExpired(allocation);
      }
    }

    if (expired.length > 0) {
      this.options.displayMetrics?.recordExpiredPurged(expired.length);
    }

    return expired.length;
  }

  getDisplayStatusSync(): {
    userSuppressed: boolean;
    activeSession: boolean;
    cacheDisplayed: number;
    sessionState: DisplaySessionState | "idle";
  } {
    return {
      userSuppressed: this.options.frequencyGuard.isUserSuppressedSync(),
      activeSession: this.activeSession !== undefined,
      cacheDisplayed: this.options.cacheStore.countByState("displayed"),
      sessionState: this.getSessionState(),
    };
  }

  private async markVisible(session: DisplayLifecycleSession): Promise<void> {
    if (session.state === "visible") {
      return;
    }

    session.state = "visible";
    session.visibleSinceMs = this.now();
    this.options.displayMetrics?.setSessionState("visible");
    this.scheduleSessionTimeout();
  }

  private scheduleSessionTimeout(): void {
    this.clearSessionTimeout();
    this.timeoutHandle = setTimeout(() => {
      void this.dismissCurrent("timeout");
    }, this.sessionTimeoutMs);
  }

  private clearSessionTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }

  private finalizeVisibleDuration(session: DisplayLifecycleSession): void {
    if (session.visibleSinceMs) {
      this.options.displayMetrics?.recordVisibleDuration(this.now() - session.visibleSinceMs);
      delete session.visibleSinceMs;
    }
  }

  private async resolveSurfaceSession(
    sessionId: string | undefined,
    allocationId: string,
  ): Promise<DisplayLifecycleSession | undefined> {
    if (this.activeSession) {
      return this.activeSession;
    }

    const allocation = await this.resolveAllocationById(allocationId);
    if (!allocation) {
      return undefined;
    }

    return this.ensureSession(sessionId, allocation);
  }

  private ensureSession(
    sessionId: string | undefined,
    allocation: CachedAllocation,
  ): DisplayLifecycleSession {
    if (this.activeSession) {
      return this.activeSession;
    }

    this.activeSession = {
      sessionId: sessionId ?? globalThis.crypto.randomUUID(),
      allocation,
      surfacesDisplayed: new Set(),
      surfaceVisibilityMs: new Map(),
      impressionRecorded: false,
      state: "pending",
    };
    this.options.displayMetrics?.setSessionState("pending");

    return this.activeSession;
  }

  private computeQualifyingMs(session: DisplayLifecycleSession, waitingPeriodMs?: number): number {
    const displayVisibleMs =
      session.visibleSinceMs !== undefined ? this.now() - session.visibleSinceMs : 0;
    const reportedVisibilityMs = Math.max(0, ...session.surfaceVisibilityMs.values());
    return Math.max(displayVisibleMs, waitingPeriodMs ?? 0, reportedVisibilityMs);
  }

  private pickImpressionSurface(session: DisplayLifecycleSession): RenderSurface {
    const candidates = new Set<RenderSurface>([
      ...session.surfacesDisplayed,
      ...session.surfaceVisibilityMs.keys(),
    ]);

    for (const surface of IMPRESSION_SURFACE_PRIORITY) {
      if (candidates.has(surface)) {
        return surface;
      }
    }

    return "cli_spinner_verb";
  }

  private async tryRecordSessionImpression(
    session: DisplayLifecycleSession,
    waitingPeriodMs?: number,
  ): Promise<void> {
    if (session.impressionRecorded) {
      this.options.displayMetrics?.recordImpressionSkip("already_recorded");
      return;
    }

    const qualifyingMs = this.computeQualifyingMs(session, waitingPeriodMs);
    if (qualifyingMs < IMPRESSION_VIEW_THRESHOLD_MS) {
      this.options.displayMetrics?.recordImpressionSkip(`below_threshold:${qualifyingMs}ms`);
      return;
    }

    const surface = this.pickImpressionSurface(session);
    session.impressionRecorded = true;
    await this.options.displayEvents.recordRenderImpression(
      session.allocation.allocationId,
      surface,
      session.sessionId,
    );

    if (!session.surfacesDisplayed.has(surface)) {
      session.surfacesDisplayed.add(surface);
      await this.markVisible(session);
      await this.options.cacheStore.markDisplayed(session.allocation.allocationId);
      await this.options.displayEvents.recordInventoryDisplayed(
        session.allocation,
        surface,
        session.sessionId,
      );
      this.options.displayMetrics?.recordInventoryDisplay();
    }
  }

  private async resolveAllocationById(allocationId: string): Promise<CachedAllocation | undefined> {
    if (this.activeSession?.allocation.allocationId === allocationId) {
      return this.activeSession.allocation;
    }

    const entry = await this.options.cacheStore.getLive<CachedAllocation>(allocationId);
    return entry?.value;
  }

  private async abandonActiveSession(reason: InventoryDismissReason): Promise<void> {
    const session = this.activeSession;
    if (!session) {
      return;
    }

    await this.options.displayEvents.recordInventoryDismissed(
      session.allocation.allocationId,
      reason,
      session.sessionId,
    );
    this.finalizeVisibleDuration(session);
    this.clearSessionTimeout();
    await this.options.frequencyGuard.endSession();
    this.activeSession = undefined;
    this.options.displayMetrics?.setSessionState("idle");
  }
}
