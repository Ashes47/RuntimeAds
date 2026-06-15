import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import { DisplayMetricsService } from "./display-metrics-service";

describe("DisplayMetricsService", () => {
  it("tracks refill, display, and dismissal counters", async () => {
    const store = new MemoryKeyValueStore();
    const metrics = new DisplayMetricsService(store);
    await metrics.start();

    metrics.recordRefillSuccess();
    metrics.recordInventoryDisplay();
    metrics.recordImpressionQueued();
    metrics.recordDismissal();
    metrics.setSessionState("visible");

    expect(metrics.getSnapshot()).toMatchObject({
      refillSuccesses: 1,
      inventoryDisplays: 1,
      impressions: 1,
      dismissals: 1,
      sessionState: "visible",
    });
  });
});
