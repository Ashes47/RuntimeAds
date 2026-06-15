import type { KeyValueStore } from "./key-value-store";
import {
  computeStoreMac,
  type IntegrityKeyProvider,
  isSignedRecord,
  type SignedRecord,
} from "./store-integrity";

export class SignedKeyValueStore implements KeyValueStore {
  constructor(
    private readonly inner: KeyValueStore,
    private readonly keyProvider: IntegrityKeyProvider,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const stored = await this.inner.get<SignedRecord<T> | T>(key);
    if (stored === undefined) {
      return undefined;
    }

    if (!isSignedRecord(stored)) {
      await this.inner.delete(key);
      return undefined;
    }

    const integrityKey = await this.keyProvider.getIntegrityKey();
    const expectedMac = computeStoreMac(integrityKey, stored.data);
    if (stored.mac !== expectedMac) {
      await this.inner.delete(key);
      return undefined;
    }

    return stored.data;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const integrityKey = await this.keyProvider.getIntegrityKey();
    const record: SignedRecord<T> = {
      data: value,
      mac: computeStoreMac(integrityKey, value),
    };

    await this.inner.set(key, record);
  }

  async delete(key: string): Promise<void> {
    await this.inner.delete(key);
  }
}
