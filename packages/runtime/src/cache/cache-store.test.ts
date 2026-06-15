import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import { CacheStore } from "./cache-store";

describe("CacheStore", () => {
  it("stores active entries and marks consumed entries inactive", async () => {
    const cache = new CacheStore(new MemoryKeyValueStore());

    await cache.put({ id: "entry-1", value: { kind: "config" } });

    expect(cache.size()).toBe(1);
    expect(await cache.getActive("entry-1")).toMatchObject({
      id: "entry-1",
      state: "active",
      value: { kind: "config" },
    });

    await cache.markConsumed("entry-1");

    expect(cache.size()).toBe(0);
    expect(await cache.getActive("entry-1")).toBeUndefined();
  });

  it("clear() removes every entry across all states", async () => {
    const store = new MemoryKeyValueStore();
    const cache = new CacheStore(store);

    await cache.put({ id: "active-1", value: { kind: "inventory" } });
    await cache.put({ id: "displayed-1", value: { kind: "inventory" } });
    await cache.markDisplayed("displayed-1");

    await cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.countByState("displayed")).toBe(0);
    expect(await cache.getActive("active-1")).toBeUndefined();

    const reloaded = new CacheStore(store);
    expect(await reloaded.listActive()).toHaveLength(0);
  });

  it("tracks displayed entries separately from active inventory", async () => {
    const cache = new CacheStore(new MemoryKeyValueStore());

    await cache.put({ id: "entry-1", value: { kind: "inventory" } });
    await cache.markDisplayed("entry-1");

    expect(cache.size()).toBe(0);
    expect(cache.countByState("displayed")).toBe(1);
    expect((await cache.getLive("entry-1"))?.state).toBe("displayed");
    expect(await cache.getActive("entry-1")).toBeUndefined();
  });

  it("expires stale entries on read", async () => {
    const cache = new CacheStore(new MemoryKeyValueStore());

    await cache.put({
      id: "entry-1",
      value: { kind: "inventory" },
      expiresAt: "2026-01-01T10:00:00.000Z",
    });

    expect(await cache.getActive("entry-1")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});
