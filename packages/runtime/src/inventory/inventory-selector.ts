import type { CachedAllocation } from "@runtimeads/sdk-contracts";

import type { CacheStore } from "../cache/cache-store";

/**
 * FIFO selection over active cached allocations in backend batch order.
 * Priority lives in server-side cache composition, not client rendering.
 */
export class InventorySelector {
  constructor(private readonly cacheStore: CacheStore) {}

  async selectNext(): Promise<CachedAllocation | undefined> {
    return this.pickFirstInOrder(await this.cacheStore.listActive<CachedAllocation>());
  }

  /** Prefer active inventory; fall back to displayed entries still on screen. */
  async selectForDisplay(): Promise<CachedAllocation | undefined> {
    const active = await this.pickFirstInOrder(
      await this.cacheStore.listActive<CachedAllocation>(),
    );
    if (active) {
      return active;
    }

    return this.pickFirstInOrder(await this.cacheStore.listDisplayed<CachedAllocation>());
  }

  private pickFirstInOrder(
    entries: Array<{ value: CachedAllocation; createdAt: string }>,
  ): CachedAllocation | undefined {
    if (entries.length === 0) {
      return undefined;
    }

    const sorted = [...entries].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
    return sorted[0]?.value;
  }
}
