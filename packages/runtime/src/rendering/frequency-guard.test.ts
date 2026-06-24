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

  it("has no time cooldown between renders — an ad can render again immediately", async () => {
    const guard = new FrequencyGuard({ store: new MemoryKeyValueStore() });

    await guard.recordRender("2026-01-01T10:00:00.000Z");
    // No MIN_RENDER_INTERVAL: a just-completed render does not block the next one. The 5s
    // impression-validity threshold lives in the display lifecycle, not here.
    expect(await guard.canRender()).toBe(true);
  });
});
