export { RenderOutcomeTracker } from "./accounting/render-outcome-tracker";
export { RuntimeApiClient, type RuntimeApiClientOptions } from "./api/runtime-api-client";
export { AuthSessionManager, type AuthClient, type AuthStatus } from "./auth/auth-session-manager";
export { CredentialVault } from "./auth/credential-vault";
export { CacheStore, type CacheEntry, type CacheState } from "./cache/cache-store";
export { DiagnosticsService, type DiagnosticsSnapshot } from "./diagnostics/diagnostics-service";
export { LocalDatabase, type Migration } from "./db/local-database";
export {
  SqliteKeyValueStore,
  type SqliteDatabase,
  type SqliteStatement,
} from "./db/sqlite-key-value-store";
export { EventQueue, type QueuedEvent, type QueueState } from "./events/event-queue";
export { HeartbeatService, type HeartbeatClient } from "./heartbeat/heartbeat-service";
export {
  VersionCheckService,
  type ExtensionRequirements,
  type ExtensionRequirementsClient,
  type UpdateAvailableInfo,
} from "./version/version-check-service";
export { compareVersions, isVersionOlder } from "./version/version-compare";
export { InstallManager, type InstallRegistrationClient } from "./install/install-manager";
export { type SecureStore } from "./secure-store";
export { MemoryKeyValueStore, type KeyValueStore } from "./storage/key-value-store";
export {
  RUNTIMEADS_CACHE_KEY,
  RUNTIMEADS_EVENT_QUEUE_KEY,
  RUNTIMEADS_INSTALL_ID_KEY,
  RUNTIMEADS_LOCAL_STORE_KEYS,
  RUNTIMEADS_MIGRATION_VERSION_KEY,
} from "./storage/local-store-keys";
export { migrateLegacyLocalStore } from "./storage/migrate-legacy-local-store";
export { SignedKeyValueStore } from "./storage/signed-key-value-store";
export {
  SecureStoreIntegrityKeyProvider,
  computeStoreMac,
  type IntegrityKeyProvider,
} from "./storage/store-integrity";
export { AgentDetectionService } from "./signals/agent-detection-service";
export { type AgentDetector } from "./signals/agent-detector";
export { AgentSessionManager } from "./signals/agent-session-manager";
export {
  AttentionStateMachine,
  InvalidAttentionTransitionError,
} from "./signals/attention-state-machine";
export { AttentionSignalGenerator } from "./signals/attention-signal-generator";
export { ClaudeAdapter } from "./signals/claude-adapter";
export { CodexAdapter } from "./signals/codex-adapter";
export { ProcessClaudeDetector } from "./signals/process-claude-detector";
export {
  InventoryRefillService,
  type InventoryRefillClient,
} from "./inventory/inventory-refill-service";
export { InventorySelector } from "./inventory/inventory-selector";
export { DisplayEventService } from "./rendering/display-event-service";
export {
  DisplayLifecycleService,
  type DisplayLifecycleSession,
  type DisplaySessionState,
  DISPLAY_SESSION_TIMEOUT_MS,
} from "./rendering/display-lifecycle-service";
export {
  DisplayMetricsService,
  type DisplayMetricsSnapshot,
} from "./rendering/display-metrics-service";
export { FrequencyGuard, type FrequencyGuardState } from "./rendering/frequency-guard";
export { SignalObservability } from "./signals/signal-observability";
export {
  extractTerminalHookMetadata,
  mapTerminalHookToObservation,
  normalizeTerminalSessionId,
  type TerminalHookMetadata,
} from "./signals/terminal-hook-mapper";
export { renderStatusBarAd } from "./rendering/status-bar-ad-renderer";
export {
  containsLegacySpinnerImage,
  formatCliAdText,
  sanitizeSpinnerVerb,
  stripControlChars,
} from "./rendering/terminal-spinner-renderer";
export { SyncEngine, type EventUploadClient } from "./sync/sync-engine";
export { TelemetryService, type TelemetryEventType } from "./telemetry/telemetry-service";
export {
  DefaultAttentionRuntime,
  type AttentionRuntime,
  type RuntimeOptions,
} from "./runtime/attention-runtime";
export { RuntimeContainer } from "./runtime/container";
export { type RuntimeService } from "./runtime/service";

import {
  DefaultAttentionRuntime,
  type AttentionRuntime,
  type RuntimeOptions,
} from "./runtime/attention-runtime";

export function createRuntime(options: RuntimeOptions): AttentionRuntime {
  return new DefaultAttentionRuntime(options);
}
