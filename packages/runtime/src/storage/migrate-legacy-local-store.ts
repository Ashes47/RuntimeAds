import { RUNTIMEADS_LOCAL_STORE_KEYS } from "./local-store-keys";
import type { KeyValueStore } from "./key-value-store";

export interface LegacyLocalStoreReader {
  get<T>(key: string): Promise<T | undefined>;
  delete(key: string): Promise<void>;
}

export async function migrateLegacyLocalStore(
  source: LegacyLocalStoreReader,
  target: KeyValueStore,
): Promise<string[]> {
  const migrated: string[] = [];

  for (const key of RUNTIMEADS_LOCAL_STORE_KEYS) {
    const value = await source.get<unknown>(key);
    if (value === undefined) {
      continue;
    }

    await target.set(key, value);
    await source.delete(key);
    migrated.push(key);
  }

  return migrated;
}
