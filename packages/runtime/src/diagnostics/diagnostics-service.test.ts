import { describe, expect, it } from "vitest";

import { DiagnosticsService } from "./diagnostics-service";

describe("DiagnosticsService", () => {
  it("records recent errors in newest-first order", () => {
    const diagnostics = new DiagnosticsService({ maxErrors: 2 });

    diagnostics.recordError("first failure", "sync-engine");
    diagnostics.recordError("second failure", "inventory.refill");

    const snapshot = diagnostics.createSnapshot({
      health: "degraded",
      authStatus: "authenticated",
      syncStatus: "error",
      networkStatus: "online",
      cacheSize: 0,
      queueSize: 0,
    });

    expect(snapshot.recentErrors).toEqual([
      expect.objectContaining({ message: "second failure", source: "inventory.refill" }),
      expect.objectContaining({ message: "first failure", source: "sync-engine" }),
    ]);
  });

  it("caps the error history ring buffer", () => {
    const diagnostics = new DiagnosticsService({ maxErrors: 1 });

    diagnostics.recordError("older", "runtime.start");
    diagnostics.recordError("newer", "runtime.stop");

    const snapshot = diagnostics.createSnapshot({
      health: "healthy",
      authStatus: "authenticated",
      syncStatus: "idle",
      networkStatus: "online",
      cacheSize: 0,
      queueSize: 0,
    });

    expect(snapshot.recentErrors).toHaveLength(1);
    expect(snapshot.recentErrors[0]?.message).toBe("newer");
  });
});
