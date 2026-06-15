import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import { FrequencyGuard } from "./frequency-guard";

describe("FrequencyGuard", () => {
  it("blocks renders after dismiss until user suppress is cleared", async () => {
    const guard = new FrequencyGuard({ store: new MemoryKeyValueStore() });

    expect(await guard.canRender()).toBe(true);
    await guard.dismissForSession();
    expect(await guard.canRender()).toBe(false);
    await guard.endSession();
    expect(await guard.canRender()).toBe(false);
    await guard.clearUserSuppress();
    expect(await guard.canRender()).toBe(true);
  });

  it("enforces the minimum interval between renders", async () => {
    let now = Date.parse("2026-01-01T10:00:00.000Z");
    const guard = new FrequencyGuard({
      store: new MemoryKeyValueStore(),
      now: () => now,
    });

    await guard.recordRender("2026-01-01T10:00:00.000Z");
    expect(await guard.canRender()).toBe(false);

    now += 5000;
    expect(await guard.canRender()).toBe(true);
  });
});
