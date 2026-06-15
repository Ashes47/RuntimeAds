import type { KeyValueStore } from "../../storage/key-value-store";
import type { CacheEntry } from "../../cache/cache-store";
import type { QueuedEvent } from "../../events/event-queue";
import type { Migration } from "../local-database";
import { CacheEntriesStore } from "../cache-entries-store";
import { PendingEventsStore } from "../pending-events-store";
import { RuntimeStateStore } from "../runtime-state-store";
import { initializeLocalSchema } from "../schema";
import type { SqliteDatabase } from "../sqlite-key-value-store";

const QUEUE_KEY = "runtimeads.event_queue.records";
const CACHE_KEY = "runtimeads.cache.entries";
const INSTALL_ID_KEY = "runtimeads.install_id";
const MIGRATION_VERSION_KEY = "runtimeads.local_db.migration_version";

export function createFourTableSchemaMigration(
  database: SqliteDatabase,
  settingsStore: KeyValueStore,
): Migration {
  return {
    version: 1,
    name: "four-table-schema",
    async up() {
      initializeLocalSchema(database);

      const pendingEvents = new PendingEventsStore(database);
      const cacheEntries = new CacheEntriesStore(database);
      const runtimeState = new RuntimeStateStore(database);

      const queuedEvents = (await settingsStore.get<QueuedEvent[]>(QUEUE_KEY)) ?? [];
      if (queuedEvents.length > 0) {
        await pendingEvents.replaceAll(queuedEvents);
        await settingsStore.delete(QUEUE_KEY);
      }

      const cache = (await settingsStore.get<CacheEntry[]>(CACHE_KEY)) ?? [];
      if (cache.length > 0) {
        await cacheEntries.replaceAll(cache);
        await settingsStore.delete(CACHE_KEY);
      }

      const installId = await settingsStore.get<string>(INSTALL_ID_KEY);
      if (installId) {
        await runtimeState.set(INSTALL_ID_KEY, installId);
        await settingsStore.delete(INSTALL_ID_KEY);
      }

      const migrationVersion = await settingsStore.get<number>(MIGRATION_VERSION_KEY);
      if (migrationVersion !== undefined) {
        await runtimeState.set(MIGRATION_VERSION_KEY, migrationVersion);
        await settingsStore.delete(MIGRATION_VERSION_KEY);
      }
    },
  };
}
