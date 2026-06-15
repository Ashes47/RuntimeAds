import type { RuntimeApiClient } from "../api/runtime-api-client";
import type { DisplayMetricsService } from "../rendering/display-metrics-service";

const MAX_PENDING = 50;
const MAX_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 5_000;

export interface RenderOutcomeTrackerOptions {
  client: RuntimeApiClient;
  displayMetrics: DisplayMetricsService;
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

interface PendingRenderEvent {
  eventId: string;
  eventType: "render.impression" | "render.click";
  attempts: number;
}

export class RenderOutcomeTracker {
  private readonly scheduler: Scheduler;
  private readonly pending: PendingRenderEvent[] = [];
  private intervalHandle: unknown;

  constructor(private readonly options: RenderOutcomeTrackerOptions) {
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  start(): void {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.pollPending().catch(() => undefined);
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  trackUploaded(events: Array<{ eventId: string; eventType: string }>): void {
    for (const event of events) {
      if (event.eventType !== "render.impression" && event.eventType !== "render.click") {
        continue;
      }

      this.pending.push({
        eventId: event.eventId,
        eventType: event.eventType,
        attempts: 0,
      });
    }

    while (this.pending.length > MAX_PENDING) {
      this.pending.shift();
    }
  }

  private async pollPending(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }

    const remaining: PendingRenderEvent[] = [];

    for (const pending of this.pending) {
      pending.attempts += 1;

      try {
        const trace = await this.options.client.getEventAccountingTrace(pending.eventId);
        if (!trace.processed) {
          if (pending.attempts < MAX_ATTEMPTS) {
            remaining.push(pending);
          }
          continue;
        }

        if (pending.eventType === "render.impression") {
          if (trace.verifiedImpression) {
            this.options.displayMetrics.recordImpressionVerified();
          } else if (trace.rejection) {
            this.options.displayMetrics.recordImpressionRejected();
          }
        } else if (trace.verifiedClick) {
          this.options.displayMetrics.recordClickVerified();
        } else if (trace.rejection) {
          this.options.displayMetrics.recordClickRejected();
        }
      } catch {
        if (pending.attempts < MAX_ATTEMPTS) {
          remaining.push(pending);
        }
      }
    }

    this.pending.splice(0, this.pending.length, ...remaining);
  }
}
