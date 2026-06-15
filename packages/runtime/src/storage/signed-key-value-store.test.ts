import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "./key-value-store";
import { SignedKeyValueStore } from "./signed-key-value-store";
import { computeStoreMac, type IntegrityKeyProvider } from "./store-integrity";

describe("SignedKeyValueStore", () => {
  it("round-trips signed values", async () => {
    const store = createSignedStore("integrity-key");

    await store.set("runtimeads.install_id", "install-1");

    expect(await store.get("runtimeads.install_id")).toBe("install-1");
  });

  it("rejects tampered values and deletes the corrupted record", async () => {
    const inner = new MemoryKeyValueStore();
    const keyProvider = createKeyProvider("integrity-key");
    const store = new SignedKeyValueStore(inner, keyProvider);

    await store.set("runtimeads.cache.entries", [{ id: "cache-1" }]);
    const stored = await inner.get<{ data: unknown; mac: string }>("runtimeads.cache.entries");
    expect(stored).toBeDefined();

    await inner.set("runtimeads.cache.entries", {
      data: [{ id: "cache-tampered" }],
      mac: stored?.mac,
    });

    expect(await store.get("runtimeads.cache.entries")).toBeUndefined();
    expect(await inner.get("runtimeads.cache.entries")).toBeUndefined();
  });

  it("rejects legacy unsigned values", async () => {
    const inner = new MemoryKeyValueStore();
    const store = new SignedKeyValueStore(inner, createKeyProvider("integrity-key"));

    await inner.set("runtimeads.install_id", "install-legacy");

    expect(await store.get("runtimeads.install_id")).toBeUndefined();
    expect(await inner.get("runtimeads.install_id")).toBeUndefined();
  });
});

function createSignedStore(integrityKey: string) {
  return new SignedKeyValueStore(new MemoryKeyValueStore(), createKeyProvider(integrityKey));
}

function createKeyProvider(integrityKey: string): IntegrityKeyProvider {
  return {
    async getIntegrityKey() {
      return integrityKey;
    },
  };
}

describe("computeStoreMac", () => {
  it("changes when payload changes", () => {
    const left = computeStoreMac("key", { healthy: true });
    const right = computeStoreMac("key", { healthy: false });

    expect(left).not.toBe(right);
  });
});
