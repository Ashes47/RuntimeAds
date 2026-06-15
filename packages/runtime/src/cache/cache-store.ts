import type { CacheEntriesStore } from "../db/cache-entries-store";
import type { KeyValueStore } from "../storage/key-value-store";

const CACHE_KEY = "runtimeads.cache.entries";

export type CacheState = "active" | "displayed" | "expired" | "consumed";

export interface CacheEntry<TValue = unknown> {
  id: string;
  value: TValue;
  state: CacheState;
  createdAt: string;
  expiresAt?: string;
}

export class CacheStore {
  private entries: CacheEntry[] = [];
  private loaded = false;

  constructor(
    private readonly store: KeyValueStore,
    private readonly cacheEntries?: CacheEntriesStore,
  ) {}

  async start(): Promise<void> {
    await this.load();
    await this.expireStale();
  }

  /** Mark expired entries and return those transitioned from active. */
  async expireStale(): Promise<Array<CacheEntry>> {
    await this.load();
    const now = Date.now();
    const expired: CacheEntry[] = [];

    this.entries = this.entries.map((entry) => {
      if (
        (entry.state !== "active" && entry.state !== "displayed") ||
        !entry.expiresAt ||
        Date.parse(entry.expiresAt) > now
      ) {
        return entry;
      }

      const next = { ...entry, state: "expired" as const };
      expired.push(next);
      return next;
    });

    if (expired.length > 0) {
      await this.persist();
    }

    return expired;
  }

  /** Remove every cached entry. Used by full integration teardown. */
  async clear(): Promise<void> {
    await this.load();
    this.entries = [];
    await this.persist();
  }

  async put<TValue>(entry: {
    id: string;
    value: TValue;
    expiresAt?: string;
  }): Promise<CacheEntry<TValue>> {
    await this.load();

    const cacheEntry: CacheEntry<TValue> = {
      id: entry.id,
      value: entry.value,
      state: "active",
      createdAt: new Date().toISOString(),
      ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
    };

    this.entries = [...this.entries.filter((candidate) => candidate.id !== entry.id), cacheEntry];
    await this.persist();
    return cacheEntry;
  }

  async getActive<TValue>(id: string): Promise<CacheEntry<TValue> | undefined> {
    await this.runExpireStale();
    return this.entries.find((entry) => entry.id === id && entry.state === "active") as
      | CacheEntry<TValue>
      | undefined;
  }

  async getLive<TValue>(id: string): Promise<CacheEntry<TValue> | undefined> {
    await this.runExpireStale();
    return this.entries.find(
      (entry) => entry.id === id && (entry.state === "active" || entry.state === "displayed"),
    ) as CacheEntry<TValue> | undefined;
  }

  /**
   * Look up an entry by id regardless of state (including consumed/expired). Used to resolve a
   * click's destination even when the ad has already been counted (TD-028) — a user can click a
   * sponsor after it stopped showing, and we still want the redirect.
   */
  async getEntry<TValue>(id: string): Promise<CacheEntry<TValue> | undefined> {
    return this.entries.find((entry) => entry.id === id) as CacheEntry<TValue> | undefined;
  }

  async listActive<TValue>(): Promise<Array<CacheEntry<TValue>>> {
    await this.runExpireStale();
    return this.entries.filter((entry) => entry.state === "active") as Array<CacheEntry<TValue>>;
  }

  async listDisplayed<TValue>(): Promise<Array<CacheEntry<TValue>>> {
    await this.runExpireStale();
    return this.entries.filter((entry) => entry.state === "displayed") as Array<CacheEntry<TValue>>;
  }

  async markDisplayed(id: string): Promise<void> {
    await this.updateState(id, "displayed");
  }

  async markConsumed(id: string): Promise<void> {
    await this.updateState(id, "consumed");
  }

  size(): number {
    return this.entries.filter((entry) => entry.state === "active").length;
  }

  async oldestActiveAgeSeconds(): Promise<number | undefined> {
    await this.runExpireStale();
    const active = this.entries.filter((entry) => entry.state === "active");
    if (active.length === 0) {
      return undefined;
    }

    const oldest = active.reduce((left, right) =>
      left.createdAt.localeCompare(right.createdAt) <= 0 ? left : right,
    );
    return Math.max(0, Math.floor((Date.now() - Date.parse(oldest.createdAt)) / 1000));
  }

  async listActiveIds(): Promise<string[]> {
    await this.runExpireStale();
    return this.entries.filter((entry) => entry.state === "active").map((entry) => entry.id);
  }

  async removeActive(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.load();
    const discard = new Set(ids);
    this.entries = this.entries.filter(
      (entry) => !(entry.state === "active" && discard.has(entry.id)),
    );
    await this.persist();
  }

  countByState(state: CacheState): number {
    return this.entries.filter((entry) => entry.state === state).length;
  }

  private async updateState(id: string, state: CacheState): Promise<void> {
    await this.load();
    this.entries = this.entries.map((entry) => (entry.id === id ? { ...entry, state } : entry));
    await this.persist();
  }

  private async runExpireStale(): Promise<void> {
    await this.expireStale();
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    if (this.cacheEntries) {
      this.entries = await this.cacheEntries.listAll();
    } else {
      this.entries = (await this.store.get<CacheEntry[]>(CACHE_KEY)) ?? [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (this.cacheEntries) {
      await this.cacheEntries.replaceAll(this.entries);
      return;
    }

    await this.store.set(CACHE_KEY, this.entries);
  }
}
