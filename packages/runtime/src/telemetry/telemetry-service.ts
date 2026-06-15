import type { EventEnvelope, Platform } from "@runtimeads/sdk-contracts";

import { EventQueue } from "../events/event-queue";
import { InstallManager } from "../install/install-manager";

export type TelemetryEventType =
  | "runtime.installed"
  | "runtime.started"
  | "runtime.heartbeat"
  | "runtime.error"
  | "auth.login"
  | "auth.logout"
  | "dashboard.opened"
  | "diagnostic.opened";

export interface TelemetryServiceOptions {
  eventQueue: EventQueue;
  installManager: InstallManager;
  platform: Platform;
  sdkVersion: string;
  idFactory?: () => string;
}

export class TelemetryService {
  constructor(private readonly options: TelemetryServiceOptions) {}

  async record(
    eventType: TelemetryEventType,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const now = new Date().toISOString();
    const installId = await this.options.installManager.ensureInstallId();
    const event: EventEnvelope = {
      eventId: this.options.idFactory?.() ?? globalThis.crypto.randomUUID(),
      eventType,
      eventVersion: 1,
      occurredAt: now,
      createdAt: now,
      installId,
      platform: this.options.platform,
      sdkVersion: this.options.sdkVersion,
      payload,
    };

    await this.options.eventQueue.enqueue(event);
  }
}
