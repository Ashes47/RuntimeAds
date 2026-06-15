export const RUNTIMEADS_INSTALL_ID_KEY = "runtimeads.install_id";
export const RUNTIMEADS_EVENT_QUEUE_KEY = "runtimeads.event_queue.records";
export const RUNTIMEADS_CACHE_KEY = "runtimeads.cache.entries";
export const RUNTIMEADS_MIGRATION_VERSION_KEY = "runtimeads.local_db.migration_version";

export const RUNTIMEADS_LOCAL_STORE_KEYS = [
  RUNTIMEADS_INSTALL_ID_KEY,
  RUNTIMEADS_EVENT_QUEUE_KEY,
  RUNTIMEADS_CACHE_KEY,
  RUNTIMEADS_MIGRATION_VERSION_KEY,
] as const;

export const LOCAL_STORE_INTEGRITY_KEY = "runtimeads.local_store.integrity_key";
