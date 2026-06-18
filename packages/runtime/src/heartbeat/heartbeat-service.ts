import type { Platform } from "@runtimeads/sdk-contracts";

import { CacheStore } from "../cache/cache-store";
import { EventQueue } from "../events/event-queue";
import { InstallManager } from "../install/install-manager";
import type { RuntimeService } from "../runtime/service";

export interface HeartbeatClient {
  heartbeat(request: HeartbeatRequest): Promise<void>;
}

export interface DetectionStatsPayload {
  invalidTransitions: number;
  unknownSessions: number;
  hookObservations: number;
}

export interface HookIntegrityPayload {
  ok: boolean;
  mismatchedFiles: string[];
  fileHashes?: Record<string, string>;
  manifestMtime?: string;
}

export interface DisplayMetricsPayload {
  refillSuccesses: number;
  refillFailures: number;
  patchFailures: number;
  impressionsQueued: number;
  impressionsUploaded: number;
  inventoryDisplays: number;
  dismissals: number;
  visibleDurationMs: number;
}

export interface HeartbeatRequest {
  installId: string;
  platform: Platform;
  sdkVersion: string;
  cacheSize: number;
  queueSize: number;
  online: boolean;
  timezone?: string;
  detectionStats?: DetectionStatsPayload;
  hookIntegrity?: HookIntegrityPayload;
  displayMetrics?: DisplayMetricsPayload;
}

export interface HeartbeatServiceOptions {
  installManager: InstallManager;
  eventQueue: EventQueue;
  cacheStore: CacheStore;
  platform: Platform;
  sdkVersion: string;
  // P1-20: IANA timezone from the host, refreshed on each heartbeat.
  timezone?: string;
  client?: HeartbeatClient;
  intervalMs?: number;
  scheduler?: HeartbeatScheduler;
  onSuccessfulHeartbeat?: () => Promise<void>;
  isOnline?: () => boolean;
  detectionStatsProvider?: () => DetectionStatsPayload;
  hookIntegrityProvider?: () => HookIntegrityPayload | undefined;
  displayMetricsProvider?: () => DisplayMetricsPayload;
}

export interface HeartbeatScheduler {
  setInterval(handler: () => void, timeoutMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: HeartbeatScheduler = {
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

export class HeartbeatService implements RuntimeService {
  readonly name = "heartbeat-service";

  private readonly intervalMs: number;
  private readonly scheduler: HeartbeatScheduler;
  private intervalHandle: unknown;
  private lastHeartbeatAt: string | undefined;
  private lastError: string | undefined;

  constructor(private readonly options: HeartbeatServiceOptions) {
    this.intervalMs = options.intervalMs ?? 15 * 60_000;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  async start(): Promise<void> {
    // Only schedule the recurring beat. The INITIAL beat is sent by the runtime after install
    // registration (attention-runtime.start) — sending one here too would double-fire at startup
    // and the pre-registration beat would 403 for a fresh install.
    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.send();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async send(): Promise<void> {
    if (!this.options.client) {
      return;
    }

    const installId = await this.options.installManager.ensureInstallId();
    const hookIntegrity = this.options.hookIntegrityProvider?.();

    try {
      await this.options.client.heartbeat({
        installId,
        platform: this.options.platform,
        sdkVersion: this.options.sdkVersion,
        cacheSize: this.options.cacheStore.size(),
        queueSize: this.options.eventQueue.size(),
        online: this.options.isOnline?.() ?? true,
        ...(this.options.timezone ? { timezone: this.options.timezone } : {}),
        ...(this.options.detectionStatsProvider
          ? { detectionStats: this.options.detectionStatsProvider() }
          : {}),
        ...(hookIntegrity ? { hookIntegrity } : {}),
        ...(this.options.displayMetricsProvider
          ? { displayMetrics: this.options.displayMetricsProvider() }
          : {}),
      });
      this.lastHeartbeatAt = new Date().toISOString();
      this.lastError = undefined;
      await this.options.onSuccessfulHeartbeat?.();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown heartbeat failure";
    }
  }

  getLastHeartbeatAt(): string | undefined {
    return this.lastHeartbeatAt;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }
}
