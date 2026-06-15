import { describe, expect, it } from "vitest";

import { CacheStore } from "../cache/cache-store";
import { InstallManager } from "../install/install-manager";
import { MemoryKeyValueStore } from "../storage/key-value-store";
import { InventoryRefillService } from "./inventory-refill-service";

describe("InventoryRefillService", () => {
  it("stores refill allocations in the cache", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    await cache.start();
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    const service = new InventoryRefillService({
      installManager,
      cacheStore: cache,
      platform: "vscode",
      sdkVersion: "0.1.0",
      targetCacheSize: 2,
      client: {
        async refillInventory() {
          return {
            batchId: "batch-1",
            mode: "append" as const,
            backendConfigVersion: "abc123",
            targetCacheSize: 20,
            refillThreshold: 5,
            leaseExpiresAt: "2099-01-02T10:00:00.000Z",
            allocations: [
              {
                allocationId: "alloc-1",
                campaignId: "campaign-1",
                brand: "Linear",
                iconUrl: "https://linear.app/favicon.ico",
                headline: "Issue tracking built for speed",
                destinationUrl: "https://linear.app",
                cpmCents: 250,
                expiresAt: "2099-01-02T10:00:00.000Z",
              },
            ],
          };
        },
      },
    });

    await service.refillIfNeeded();

    const active = await cache.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]?.value).toMatchObject({ brand: "Linear" });
  });

  it("refills only when active cache drops below the threshold", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    await cache.start();
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    let refillCalls = 0;
    const service = new InventoryRefillService({
      installManager,
      cacheStore: cache,
      platform: "vscode",
      sdkVersion: "0.1.0",
      refillThreshold: 5,
      client: {
        async refillInventory() {
          refillCalls += 1;
          return {
            batchId: "batch-1",
            mode: "append" as const,
            backendConfigVersion: "abc123",
            targetCacheSize: 20,
            refillThreshold: 5,
            leaseExpiresAt: "2099-01-02T10:00:00.000Z",
            allocations: [],
          };
        },
      },
    });

    for (let index = 0; index < 6; index += 1) {
      await cache.put({ id: `alloc-${index}`, value: { allocationId: `alloc-${index}` } });
    }

    await service.refillIfNeeded();
    expect(refillCalls).toBe(0);

    await cache.markConsumed("alloc-0");
    await cache.markConsumed("alloc-1");
    expect(cache.size()).toBe(4);

    await service.refillIfNeeded();
    expect(refillCalls).toBe(1);
  });

  it("expires stale (short-lease) entries before counting, so refill fires", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);
    await cache.start();
    const installManager = new InstallManager({
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      idFactory: () => "install-1",
    });
    await installManager.start();

    let refillCalls = 0;
    const service = new InventoryRefillService({
      installManager,
      cacheStore: cache,
      platform: "vscode",
      sdkVersion: "0.1.0",
      refillThreshold: 5,
      client: {
        async refillInventory() {
          refillCalls += 1;
          return {
            batchId: "batch-1",
            mode: "append" as const,
            backendConfigVersion: "abc123",
            targetCacheSize: 20,
            refillThreshold: 5,
            leaseExpiresAt: "2099-01-02T10:00:00.000Z",
            allocations: [],
          };
        },
      },
    });

    for (let index = 0; index < 6; index += 1) {
      await cache.put({
        id: `alloc-${index}`,
        value: { allocationId: `alloc-${index}` },
        expiresAt: "2000-01-01T00:00:00.000Z",
      });
    }

    await service.refillIfNeeded();
    expect(refillCalls).toBe(1);
  });
});
