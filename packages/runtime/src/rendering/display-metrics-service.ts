import type { KeyValueStore } from "../storage/key-value-store";

const METRICS_KEY = "runtimeads.display.metrics";

export type DisplaySessionState = "idle" | "pending" | "visible" | "dismissed" | "completed";

export interface DisplayMetricsSnapshot {
  refillSuccesses: number;
  refillFailures: number;
  emptyCacheEvents: number;
  expiredPurged: number;
  inventoryDisplays: number;
  dismissals: number;
  /** @deprecated Use impressionsQueued */
  impressions: number;
  /** @deprecated Use clicksQueued */
  clicks: number;
  impressionsQueued: number;
  impressionsUploaded: number;
  impressionsVerified: number;
  impressionsRejected: number;
  clicksQueued: number;
  clicksUploaded: number;
  clicksVerified: number;
  clicksRejected: number;
  visibleDurationMs: number;
  lifecycleTimeouts: number;
  renderErrors: number;
  patchFailures: number;
  sessionState: DisplaySessionState;
  lastRefillError?: string;
  lastImpressionSkipReason?: string;
}

const EMPTY_METRICS: DisplayMetricsSnapshot = {
  refillSuccesses: 0,
  refillFailures: 0,
  emptyCacheEvents: 0,
  expiredPurged: 0,
  inventoryDisplays: 0,
  dismissals: 0,
  impressions: 0,
  clicks: 0,
  impressionsQueued: 0,
  impressionsUploaded: 0,
  impressionsVerified: 0,
  impressionsRejected: 0,
  clicksQueued: 0,
  clicksUploaded: 0,
  clicksVerified: 0,
  clicksRejected: 0,
  visibleDurationMs: 0,
  lifecycleTimeouts: 0,
  renderErrors: 0,
  patchFailures: 0,
  sessionState: "idle",
};

export class DisplayMetricsService {
  private metrics: DisplayMetricsSnapshot = { ...EMPTY_METRICS };
  private loaded = false;

  constructor(private readonly store?: KeyValueStore) {}

  async start(): Promise<void> {
    if (!this.store || this.loaded) {
      return;
    }

    const stored = await this.store.get<DisplayMetricsSnapshot>(METRICS_KEY);
    if (stored) {
      this.metrics = this.normalize({ ...EMPTY_METRICS, ...stored });
    }

    this.loaded = true;
  }

  getSnapshot(): DisplayMetricsSnapshot {
    return { ...this.metrics };
  }

  setSessionState(state: DisplaySessionState): void {
    this.metrics.sessionState = state;
    void this.persist();
  }

  recordRefillSuccess(): void {
    this.metrics.refillSuccesses += 1;
    delete this.metrics.lastRefillError;
    void this.persist();
  }

  recordRefillFailure(message: string): void {
    this.metrics.refillFailures += 1;
    this.metrics.lastRefillError = message;
    void this.persist();
  }

  recordEmptyCache(): void {
    this.metrics.emptyCacheEvents += 1;
    void this.persist();
  }

  recordExpiredPurged(count: number): void {
    this.metrics.expiredPurged += count;
    void this.persist();
  }

  recordInventoryDisplay(): void {
    this.metrics.inventoryDisplays += 1;
    void this.persist();
  }

  recordDismissal(): void {
    this.metrics.dismissals += 1;
    void this.persist();
  }

  recordImpressionQueued(): void {
    this.metrics.impressionsQueued += 1;
    this.metrics.impressions = this.metrics.impressionsQueued;
    delete this.metrics.lastImpressionSkipReason;
    void this.persist();
  }

  recordImpressionSkip(reason: string): void {
    this.metrics.lastImpressionSkipReason = reason;
    void this.persist();
  }

  recordClickQueued(): void {
    this.metrics.clicksQueued += 1;
    this.metrics.clicks = this.metrics.clicksQueued;
    void this.persist();
  }

  recordImpressionsUploaded(count: number): void {
    if (count <= 0) {
      return;
    }
    this.metrics.impressionsUploaded += count;
    void this.persist();
  }

  recordClicksUploaded(count: number): void {
    if (count <= 0) {
      return;
    }
    this.metrics.clicksUploaded += count;
    void this.persist();
  }

  recordImpressionVerified(): void {
    this.metrics.impressionsVerified += 1;
    void this.persist();
  }

  recordImpressionRejected(): void {
    this.metrics.impressionsRejected += 1;
    void this.persist();
  }

  recordClickVerified(): void {
    this.metrics.clicksVerified += 1;
    void this.persist();
  }

  recordClickRejected(): void {
    this.metrics.clicksRejected += 1;
    void this.persist();
  }

  recordVisibleDuration(durationMs: number): void {
    if (durationMs > 0) {
      this.metrics.visibleDurationMs += durationMs;
      void this.persist();
    }
  }

  recordLifecycleTimeout(): void {
    this.metrics.lifecycleTimeouts += 1;
    void this.persist();
  }

  recordRenderError(): void {
    this.metrics.renderErrors += 1;
    void this.persist();
  }

  recordPatchFailure(): void {
    this.metrics.patchFailures += 1;
    void this.persist();
  }

  private normalize(snapshot: DisplayMetricsSnapshot): DisplayMetricsSnapshot {
    return {
      ...snapshot,
      impressionsQueued: snapshot.impressionsQueued ?? snapshot.impressions ?? 0,
      clicksQueued: snapshot.clicksQueued ?? snapshot.clicks ?? 0,
      impressions: snapshot.impressionsQueued ?? snapshot.impressions ?? 0,
      clicks: snapshot.clicksQueued ?? snapshot.clicks ?? 0,
      impressionsUploaded: snapshot.impressionsUploaded ?? 0,
      impressionsVerified: snapshot.impressionsVerified ?? 0,
      impressionsRejected: snapshot.impressionsRejected ?? 0,
      clicksUploaded: snapshot.clicksUploaded ?? 0,
      clicksVerified: snapshot.clicksVerified ?? 0,
      clicksRejected: snapshot.clicksRejected ?? 0,
    };
  }

  private async persist(): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.set(METRICS_KEY, this.metrics);
  }
}
