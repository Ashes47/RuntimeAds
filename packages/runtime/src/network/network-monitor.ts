export type NetworkStatus = "online" | "offline" | "unknown";

export interface NetworkMonitorOptions {
  probeUrl?: string;
  probeIntervalMs?: number;
  fetchFn?: typeof fetch;
  scheduler?: NetworkScheduler;
}

export interface NetworkScheduler {
  setInterval(handler: () => void, timeoutMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: NetworkScheduler = {
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

export class NetworkMonitor {
  private status: NetworkStatus = "unknown";
  private intervalHandle: unknown;
  private readonly probeUrl: string;
  private readonly probeIntervalMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly scheduler: NetworkScheduler;

  constructor(options: NetworkMonitorOptions = {}) {
    this.probeUrl = options.probeUrl ?? "https://www.google.com/generate_204";
    this.probeIntervalMs = options.probeIntervalMs ?? 15_000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  start(): void {
    void this.probe();
    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.probe();
    }, this.probeIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  getStatus(): NetworkStatus {
    return this.status;
  }

  isOnline(): boolean {
    return this.status !== "offline";
  }

  private async probe(): Promise<void> {
    try {
      const response = await this.fetchFn(this.probeUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(3_000),
      });
      this.status = response.ok || response.status === 204 ? "online" : "offline";
    } catch {
      this.status = "offline";
    }
  }
}
