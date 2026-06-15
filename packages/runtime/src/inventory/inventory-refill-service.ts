import type { CachedAllocation, Platform } from "@runtimeads/sdk-contracts";

import type { CacheStore } from "../cache/cache-store";
import type { InstallManager } from "../install/install-manager";
import type { KeyValueStore } from "../storage/key-value-store";

const CONFIG_VERSION_KEY = "runtimeads.cache.config_version";

export interface InventoryRefillClient {
  refillInventory(request: InventoryRefillRequest): Promise<InventoryRefillResponse>;
}

export type RefillMode = "append" | "replace";

export interface InventoryRefillRequest {
  installId: string;
  platform: Platform;
  sdkVersion: string;
  cacheRemaining: number;
  cacheAgeSeconds: number;
  knownConfigVersion?: string;
  forceRefresh: boolean;
  discardedAllocationIds: string[];
}

export interface InventoryRefillResponse {
  batchId: string;
  mode: RefillMode;
  backendConfigVersion: string;
  targetCacheSize: number;
  refillThreshold: number;
  leaseExpiresAt: string;
  allocations: CachedAllocation[];
}

export interface InventoryRefillServiceOptions {
  installManager: InstallManager;
  cacheStore: CacheStore;
  platform: Platform;
  sdkVersion: string;
  client?: InventoryRefillClient;
  configStore?: KeyValueStore;
  targetCacheSize?: number;
  refillThreshold?: number;
  maxCacheAgeSeconds?: number;
}

export class InventoryRefillService {
  private readonly refillThreshold: number;
  private readonly maxCacheAgeSeconds: number;

  constructor(private readonly options: InventoryRefillServiceOptions) {
    this.refillThreshold = options.refillThreshold ?? 5;
    this.maxCacheAgeSeconds = options.maxCacheAgeSeconds ?? 1800;
  }

  async refillIfNeeded(options?: {
    forceRefresh?: boolean;
  }): Promise<InventoryRefillResponse | undefined> {
    if (!this.options.client) {
      return undefined;
    }

    await this.options.cacheStore.expireStale();

    const cacheRemaining = this.options.cacheStore.size();
    const cacheAgeSeconds = (await this.options.cacheStore.oldestActiveAgeSeconds()) ?? 0;
    const knownConfigVersion = await this.getKnownConfigVersion();
    const forceRefresh = options?.forceRefresh ?? false;

    const shouldRefill =
      forceRefresh ||
      cacheRemaining < this.refillThreshold ||
      cacheAgeSeconds >= this.maxCacheAgeSeconds;

    if (!shouldRefill) {
      return undefined;
    }

    const installId = await this.options.installManager.ensureInstallId();
    const discardedAllocationIds = await this.options.cacheStore.listActiveIds();
    const response = await this.options.client.refillInventory({
      installId,
      platform: this.options.platform,
      sdkVersion: this.options.sdkVersion,
      cacheRemaining,
      cacheAgeSeconds,
      ...(knownConfigVersion ? { knownConfigVersion } : {}),
      forceRefresh,
      discardedAllocationIds,
    });

    if (response.mode === "replace") {
      await this.options.cacheStore.removeActive(discardedAllocationIds);
    }

    for (const allocation of response.allocations) {
      await this.options.cacheStore.put({
        id: allocation.allocationId,
        value: allocation,
        expiresAt: allocation.expiresAt,
      });
    }

    await this.setKnownConfigVersion(response.backendConfigVersion);
    return response;
  }

  private async getKnownConfigVersion(): Promise<string | undefined> {
    if (!this.options.configStore) {
      return undefined;
    }
    return this.options.configStore.get<string>(CONFIG_VERSION_KEY);
  }

  private async setKnownConfigVersion(version: string): Promise<void> {
    if (!this.options.configStore) {
      return;
    }
    await this.options.configStore.set(CONFIG_VERSION_KEY, version);
  }
}
