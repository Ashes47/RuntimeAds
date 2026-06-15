import type { KeyValueStore } from "@runtimeads/runtime";

export class PersistingKeyValueStore implements KeyValueStore {
  constructor(
    private readonly inner: KeyValueStore,
    private readonly persist: () => Promise<void>,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.inner.set(key, value);
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    await this.inner.delete(key);
    await this.persist();
  }
}
