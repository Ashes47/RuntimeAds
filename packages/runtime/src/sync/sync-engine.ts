import type { QueuedEvent } from "../events/event-queue";
import { EventQueue } from "../events/event-queue";
import type { NetworkMonitor } from "../network/network-monitor";
import type { RuntimeService } from "../runtime/service";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface EventUploadClient {
  uploadEvents(events: QueuedEvent[]): Promise<void>;
}

export interface SyncEngineOptions {
  eventQueue: EventQueue;
  uploadClient?: EventUploadClient;
  beforeFlush?: () => Promise<void>;
  onFlushSuccess?: (records: QueuedEvent[]) => void | Promise<void>;
  onSyncError?: (message: string) => void;
  networkMonitor?: NetworkMonitor;
  batchSize?: number;
  intervalMs?: number;
  maxBackoffMs?: number;
  scheduler?: Scheduler;
}

export interface Scheduler {
  setInterval(handler: () => void, timeoutMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

export class SyncEngine implements RuntimeService {
  readonly name = "sync-engine";

  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly scheduler: Scheduler;
  private intervalHandle: unknown;
  private flushing = false;
  private lastSyncAt: string | undefined;
  private lastSyncError: string | undefined;
  private consecutiveFailures = 0;
  private syncStatus: SyncStatus = "idle";

  constructor(private readonly options: SyncEngineOptions) {
    this.batchSize = options.batchSize ?? 100;
    this.intervalMs = options.intervalMs ?? 30_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 300_000;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  async start(): Promise<void> {
    await this.options.eventQueue.start();
    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.flush().catch(() => undefined);
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }

    if (!this.options.uploadClient) {
      return;
    }

    if (this.options.networkMonitor && !this.options.networkMonitor.isOnline()) {
      this.syncStatus = "offline";
      return;
    }

    if (this.consecutiveFailures > 0) {
      const backoffMs = Math.min(
        this.intervalMs * 2 ** (this.consecutiveFailures - 1),
        this.maxBackoffMs,
      );
      await sleep(backoffMs);
    }

    this.flushing = true;
    this.syncStatus = "syncing";
    let ids: string[] = [];

    try {
      await this.options.beforeFlush?.();

      const records = await this.options.eventQueue.listUploadable(this.batchSize);
      if (records.length === 0) {
        this.syncStatus = "idle";
        return;
      }

      ids = records.map((record) => record.id);
      await this.options.eventQueue.markProcessing(ids);
      await this.options.uploadClient.uploadEvents(records);
      await this.options.eventQueue.markCompleted(ids);
      await this.options.onFlushSuccess?.(records);
      this.lastSyncAt = new Date().toISOString();
      this.lastSyncError = undefined;
      this.consecutiveFailures = 0;
      this.syncStatus = "idle";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync failure";
      await this.options.eventQueue.markFailed(ids, message);
      this.lastSyncError = message;
      this.consecutiveFailures += 1;
      this.syncStatus = "error";
      this.options.onSyncError?.(message);
      throw error;
    } finally {
      this.flushing = false;
    }
  }

  getLastSyncAt(): string | undefined {
    return this.lastSyncAt;
  }

  getLastSyncError(): string | undefined {
    return this.lastSyncError;
  }

  getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
