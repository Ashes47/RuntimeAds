import { describe, expect, it } from "vitest";

import type { CachedAllocation } from "@runtimeads/sdk-contracts";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import { CacheStore } from "../cache/cache-store";
import { InventorySelector } from "./inventory-selector";

function allocation(id: string, cpmCents = 0): CachedAllocation {
  return {
    allocationId: id,
    campaignId: "campaign-1",
    brand: "Brand",
    iconUrl: "https://example.com/icon.png",
    headline: "Headline",
    destinationUrl: "https://example.com",
    cpmCents,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

describe("InventorySelector", () => {
  it("selects the oldest active allocation first regardless of CPM", async () => {
    const cache = new CacheStore(new MemoryKeyValueStore());
    const selector = new InventorySelector(cache);

    await cache.put({
      id: "alloc-low",
      value: allocation("alloc-low", 100),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await cache.put({
      id: "alloc-high",
      value: allocation("alloc-high", 500),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const selected = await selector.selectNext();
    expect(selected?.allocationId).toBe("alloc-low");
  });

  it("preserves FIFO order for equal CPM allocations", async () => {
    const cache = new CacheStore(new MemoryKeyValueStore());
    const selector = new InventorySelector(cache);

    await cache.put({
      id: "alloc-a",
      value: allocation("alloc-a", 200),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await cache.put({
      id: "alloc-b",
      value: allocation("alloc-b", 200),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const selected = await selector.selectNext();
    expect(selected?.allocationId).toBe("alloc-a");
  });
});
