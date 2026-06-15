import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "./key-value-store";
import {
  RUNTIMEADS_CACHE_KEY,
  RUNTIMEADS_INSTALL_ID_KEY,
  RUNTIMEADS_MIGRATION_VERSION_KEY,
} from "./local-store-keys";
import { migrateLegacyLocalStore } from "./migrate-legacy-local-store";
import { SignedKeyValueStore } from "./signed-key-value-store";
import type { IntegrityKeyProvider } from "./store-integrity";

describe("migrateLegacyLocalStore", () => {
  it("moves legacy keys into the signed target store", async () => {
    const legacy = new MemoryKeyValueStore();
    await legacy.set(RUNTIMEADS_INSTALL_ID_KEY, "install-1");
    await legacy.set(RUNTIMEADS_MIGRATION_VERSION_KEY, 1);

    const target = createSignedStore("integrity-key");
    const migrated = await migrateLegacyLocalStore(legacy, target);

    expect(migrated).toEqual([RUNTIMEADS_INSTALL_ID_KEY, RUNTIMEADS_MIGRATION_VERSION_KEY]);
    expect(await legacy.get(RUNTIMEADS_INSTALL_ID_KEY)).toBeUndefined();
    expect(await target.get(RUNTIMEADS_INSTALL_ID_KEY)).toBe("install-1");
    expect(await target.get(RUNTIMEADS_MIGRATION_VERSION_KEY)).toBe(1);
  });

  it("ignores missing legacy keys", async () => {
    const legacy = new MemoryKeyValueStore();
    const target = createSignedStore("integrity-key");

    await expect(migrateLegacyLocalStore(legacy, target)).resolves.toEqual([]);
    expect(await target.get(RUNTIMEADS_CACHE_KEY)).toBeUndefined();
  });
});

function createSignedStore(integrityKey: string) {
  const keyProvider: IntegrityKeyProvider = {
    async getIntegrityKey() {
      return integrityKey;
    },
  };

  return new SignedKeyValueStore(new MemoryKeyValueStore(), keyProvider);
}
