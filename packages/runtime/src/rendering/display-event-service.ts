import type {
  CachedAllocation,
  EventEnvelope,
  InventoryDismissReason,
  Platform,
  RenderSurface,
} from "@runtimeads/sdk-contracts";

import type { EventQueue } from "../events/event-queue";
import type { InstallManager } from "../install/install-manager";
import type { DisplayMetricsService } from "../rendering/display-metrics-service";

export interface DisplayEventServiceOptions {
  eventQueue: EventQueue;
  installManager: InstallManager;
  platform: Platform;
  sdkVersion: string;
  displayMetrics?: DisplayMetricsService;
  idFactory?: () => string;
}

export class DisplayEventService {
  constructor(private readonly options: DisplayEventServiceOptions) {}

  async recordInventoryReceived(allocation: CachedAllocation, batchId: string): Promise<void> {
    await this.enqueue("inventory.received", {
      batch_id: batchId,
      allocation_id: allocation.allocationId,
      campaign_id: allocation.campaignId,
      expires_at: allocation.expiresAt,
    });
  }

  async recordInventoryDisplayed(
    allocation: CachedAllocation,
    surface: RenderSurface,
    sessionId?: string,
  ): Promise<void> {
    await this.enqueue(
      "inventory.displayed",
      {
        allocation_id: allocation.allocationId,
        campaign_id: allocation.campaignId,
        surface,
        rendered_at: new Date().toISOString(),
      },
      sessionId,
    );
  }

  async recordInventoryDismissed(
    allocationId: string,
    reason: InventoryDismissReason,
    sessionId?: string,
  ): Promise<void> {
    await this.enqueue(
      "inventory.dismissed",
      {
        allocation_id: allocationId,
        reason,
      },
      sessionId,
    );
  }

  async recordInventoryExpired(allocation: CachedAllocation): Promise<void> {
    await this.enqueue("inventory.expired", {
      allocation_id: allocation.allocationId,
      campaign_id: allocation.campaignId,
    });
  }

  async recordRenderImpression(
    allocationId: string,
    surface: RenderSurface,
    sessionId?: string,
  ): Promise<void> {
    await this.enqueue(
      "render.impression",
      {
        allocation_id: allocationId,
        surface,
      },
      sessionId,
    );
  }

  async recordRenderClick(
    allocationId: string,
    surface: RenderSurface,
    sessionId?: string,
  ): Promise<void> {
    await this.enqueue(
      "render.click",
      {
        allocation_id: allocationId,
        surface,
      },
      sessionId,
    );
  }

  private async enqueue(
    eventType: string,
    payload: Record<string, unknown>,
    sessionId?: string,
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
      ...(sessionId ? { sessionId } : {}),
    };

    await this.options.eventQueue.enqueue(event);

    if (eventType === "render.impression") {
      this.options.displayMetrics?.recordImpressionQueued();
    } else if (eventType === "render.click") {
      this.options.displayMetrics?.recordClickQueued();
    }
  }
}
