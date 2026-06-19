import type { Platform, RuntimeStatus } from "@runtimeads/sdk-contracts";

import { RuntimeApiClient } from "../api/runtime-api-client";
import { RenderOutcomeTracker } from "../accounting/render-outcome-tracker";
import { AuthSessionManager, type AuthClient } from "../auth/auth-session-manager";
import { CredentialVault } from "../auth/credential-vault";
import { CacheStore } from "../cache/cache-store";
import { CacheEntriesStore } from "../db/cache-entries-store";
import { createFourTableSchemaMigration } from "../db/migrations/001-four-table-schema";
import { LocalDatabase } from "../db/local-database";
import { PendingEventsStore } from "../db/pending-events-store";
import { RuntimeStateStore } from "../db/runtime-state-store";
import type { SqliteDatabase } from "../db/sqlite-key-value-store";
import { DiagnosticsService } from "../diagnostics/diagnostics-service";
import { EventQueue } from "../events/event-queue";
import { HeartbeatService, type HeartbeatClient } from "../heartbeat/heartbeat-service";
import type { InstallRegistrationClient } from "../install/install-manager";
import { InventoryRefillService } from "../inventory/inventory-refill-service";
import { DisplayEventService } from "../rendering/display-event-service";
import { DisplayLifecycleService } from "../rendering/display-lifecycle-service";
import { DisplayMetricsService } from "../rendering/display-metrics-service";
import { FrequencyGuard } from "../rendering/frequency-guard";
import { InstallManager } from "../install/install-manager";
import type { SecureStore } from "../secure-store";
import { MemoryKeyValueStore, type KeyValueStore } from "../storage/key-value-store";
import { NetworkMonitor } from "../network/network-monitor";
import { SyncEngine, type EventUploadClient } from "../sync/sync-engine";
import { AgentDetectionService } from "../signals/agent-detection-service";
import type { AgentDetector } from "../signals/agent-detector";
import { ClaudeAdapter } from "../signals/claude-adapter";
import { TelemetryService } from "../telemetry/telemetry-service";
import {
  VersionCheckService,
  type ExtensionRequirementsClient,
  type UpdateAvailableInfo,
} from "../version/version-check-service";
import { RuntimeContainer } from "./container";
import type { RuntimeService } from "./service";

export interface RuntimeOptions {
  platform: Platform;
  secureStore: SecureStore;
  localStore?: KeyValueStore;
  sdkVersion?: string;
  idFactory?: () => string;
  apiBaseUrl?: string;
  os?: string;
  // P1-20: IANA timezone from the host (Intl.DateTimeFormat().resolvedOptions().timeZone).
  timezone?: string;
  // P1-25 extension version gate metadata, surfaced from the host extension manifest.
  extensionId?: string;
  extensionVersion?: string;
  publisher?: string;
  /** Called when the server rejects registration as outdated (HTTP 426). */
  onVersionRejected?: () => void;
  /**
   * Called when the 1-min version-check poll finds a newer build than the running one.
   * Proactive complement to onVersionRejected (which only fires once the build is too old
   * to register). At most one call per discovered version.
   */
  onUpdateAvailable?: (info: UpdateAvailableInfo) => void;
  /** Called when the refresh token is rejected and the user must sign in again. */
  onSessionExpired?: () => void;
  /**
   * Called when the account is banned (API returns 403 ``account_banned``). The runtime has
   * already signed out, stopped, and cleared cached ads by the time this fires — the host should
   * just inform the user (they can still open the web dashboard to appeal).
   */
  onAccountBanned?: () => void;
  registrationClient?: InstallRegistrationClient;
  eventUploadClient?: EventUploadClient;
  heartbeatClient?: HeartbeatClient;
  authClient?: AuthClient;
  agentDetectors?: AgentDetector[];
  sqliteDatabase?: SqliteDatabase;
  hookIntegrityProvider?: () =>
    | {
        ok: boolean;
        mismatchedFiles: string[];
        fileHashes?: Record<string, string>;
        manifestMtime?: string;
      }
    | undefined;
}

export interface AttentionRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  ensureInstallRegistered(force?: boolean): Promise<void>;
  refillInventoryIfNeeded(): Promise<void>;
  /** True once the build is known outdated (HTTP 426 or below min_supported); ads are paused. */
  isAdServingPaused(): boolean;
  getStatus(): RuntimeStatus;
  getAuthSessionManager(): AuthSessionManager;
  getCredentialVault(): CredentialVault;
  getCacheStore(): CacheStore;
  getDiagnosticsService(): DiagnosticsService;
  getEventQueue(): EventQueue;
  getHeartbeatService(): HeartbeatService;
  getInstallManager(): InstallManager;
  getSyncEngine(): SyncEngine;
  getTelemetryService(): TelemetryService;
  getAgentDetectionService(): AgentDetectionService;
  getDisplayLifecycleService(): DisplayLifecycleService;
  getDisplayMetricsService(): DisplayMetricsService;
}

export class DefaultAttentionRuntime implements AttentionRuntime {
  private readonly container = new RuntimeContainer();
  private readonly authSessionManager: AuthSessionManager;
  private readonly cacheStore: CacheStore;
  private readonly credentialVault: CredentialVault;
  private readonly diagnosticsService: DiagnosticsService;
  private readonly eventQueue: EventQueue;
  private readonly heartbeatService: HeartbeatService;
  private readonly versionCheckService: VersionCheckService;
  private readonly installManager: InstallManager;
  private readonly localDatabase: LocalDatabase;
  private readonly syncEngine: SyncEngine;
  private readonly telemetryService: TelemetryService;
  private readonly agentDetectionService: AgentDetectionService;
  private readonly inventoryRefillService: InventoryRefillService;
  private readonly displayLifecycleService: DisplayLifecycleService;
  private readonly displayEventService: DisplayEventService;
  private readonly displayMetricsService: DisplayMetricsService;
  private readonly renderOutcomeTracker: RenderOutcomeTracker | undefined;
  private readonly networkMonitor: NetworkMonitor;
  private lastRefillAt: string | undefined;
  private startedAt: string | undefined;
  private lastError: string | undefined;
  private versionRejected = false;
  private accountBanned = false;
  private readonly onAccountBanned: (() => void) | undefined;
  // Install id we've already registered this session. ensureInstallRegistered runs before every
  // event-queue flush, so without this it would re-POST /v1/runtime/register on every sync cycle.
  private registeredInstallId: string | undefined;
  private readonly onVersionRejected: (() => void) | undefined;

  constructor(options: RuntimeOptions) {
    this.onVersionRejected = options.onVersionRejected;
    this.onAccountBanned = options.onAccountBanned;
    const localStore = options.localStore ?? new MemoryKeyValueStore();
    let apiClient: RuntimeApiClient | undefined;
    const getApiClient = () => {
      if (!options.apiBaseUrl) {
        return undefined;
      }

      apiClient ??= new RuntimeApiClient({
        baseUrl: options.apiBaseUrl,
        accessTokenProvider: async () => this.credentialVault.getAccessToken(),
        refreshAccessToken: async () => this.authSessionManager.refreshAccessToken(),
        onAccountBanned: () => {
          void this.handleAccountBanned();
        },
      });
      return apiClient;
    };
    const registrationClient = options.registrationClient ?? getApiClient();
    const eventUploadClient = options.eventUploadClient ?? getApiClient();
    const heartbeatClient = options.heartbeatClient ?? getApiClient();
    const authClient = options.authClient ?? getApiClient();
    const sdkVersion = options.sdkVersion ?? "0.1.0";

    const pendingEventsStore = options.sqliteDatabase
      ? new PendingEventsStore(options.sqliteDatabase)
      : undefined;
    const cacheEntriesStore = options.sqliteDatabase
      ? new CacheEntriesStore(options.sqliteDatabase)
      : undefined;
    const runtimeStateStore = options.sqliteDatabase
      ? new RuntimeStateStore(options.sqliteDatabase)
      : undefined;
    const migrations = options.sqliteDatabase
      ? [createFourTableSchemaMigration(options.sqliteDatabase, localStore)]
      : [];

    this.cacheStore = new CacheStore(localStore, cacheEntriesStore);
    this.credentialVault = new CredentialVault(options.secureStore);
    this.authSessionManager = new AuthSessionManager(
      this.credentialVault,
      authClient,
      options.onSessionExpired,
    );
    this.diagnosticsService = new DiagnosticsService();
    this.eventQueue = new EventQueue(localStore, pendingEventsStore);
    this.localDatabase = new LocalDatabase(localStore, migrations, runtimeStateStore);
    const installManagerOptions = {
      platform: options.platform,
      sdkVersion,
      store: runtimeStateStore ?? localStore,
      ...(options.os ? { os: options.os } : {}),
      ...(options.timezone ? { timezone: options.timezone } : {}),
      ...(options.extensionId ? { extensionId: options.extensionId } : {}),
      ...(options.extensionVersion ? { extensionVersion: options.extensionVersion } : {}),
      ...(options.publisher ? { publisher: options.publisher } : {}),
      ...(registrationClient ? { registrationClient } : {}),
    };

    this.installManager = new InstallManager(
      options.idFactory
        ? {
            ...installManagerOptions,
            idFactory: options.idFactory,
          }
        : installManagerOptions,
    );

    this.registerService(this.localDatabase);
    this.registerService({
      name: "auth-session-manager",
      start: async () => {
        await this.authSessionManager.start();
      },
    });
    this.displayMetricsService = new DisplayMetricsService(localStore);
    this.displayEventService = new DisplayEventService({
      eventQueue: this.eventQueue,
      installManager: this.installManager,
      platform: options.platform,
      sdkVersion,
      displayMetrics: this.displayMetricsService,
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
    });
    const frequencyGuard = new FrequencyGuard({ store: localStore });
    this.displayLifecycleService = new DisplayLifecycleService({
      cacheStore: this.cacheStore,
      displayEvents: this.displayEventService,
      frequencyGuard,
      displayMetrics: this.displayMetricsService,
    });
    this.registerService({
      name: "display-metrics",
      start: async () => {
        await this.displayMetricsService.start();
      },
    });
    this.registerService({
      name: "cache-store",
      start: async () => {
        await this.cacheStore.start();
      },
    });
    this.registerService({
      name: "event-queue",
      start: async () => {
        await this.eventQueue.start();
      },
    });
    this.registerService({
      name: "install-manager",
      start: async () => {
        await this.installManager.start();
      },
    });
    this.telemetryService = new TelemetryService({
      eventQueue: this.eventQueue,
      installManager: this.installManager,
      platform: options.platform,
      sdkVersion,
    });
    this.networkMonitor = new NetworkMonitor();
    const traceClient = getApiClient();
    this.renderOutcomeTracker = traceClient
      ? new RenderOutcomeTracker({
          client: traceClient,
          displayMetrics: this.displayMetricsService,
        })
      : undefined;
    this.syncEngine = new SyncEngine({
      eventQueue: this.eventQueue,
      ...(eventUploadClient ? { uploadClient: eventUploadClient } : {}),
      networkMonitor: this.networkMonitor,
      beforeFlush: async () => {
        await this.ensureInstallRegistered();
      },
      onFlushSuccess: async (records) => {
        let impressionsUploaded = 0;
        let clicksUploaded = 0;

        for (const record of records) {
          if (record.event.eventType === "render.impression") {
            impressionsUploaded += 1;
          } else if (record.event.eventType === "render.click") {
            clicksUploaded += 1;
          }
        }

        this.displayMetricsService.recordImpressionsUploaded(impressionsUploaded);
        this.displayMetricsService.recordClicksUploaded(clicksUploaded);
        this.renderOutcomeTracker?.trackUploaded(
          records.map((record) => ({
            eventId: record.event.eventId,
            eventType: record.event.eventType,
          })),
        );
      },
      onSyncError: (message) => {
        this.recordRuntimeError(message, "sync-engine");
      },
    });
    this.registerService({
      name: "network-monitor",
      start: async () => {
        this.networkMonitor.start();
      },
      stop: async () => {
        this.networkMonitor.stop();
      },
    });
    this.registerService(this.syncEngine);
    if (this.renderOutcomeTracker) {
      this.registerService({
        name: "render-outcome-tracker",
        start: async () => {
          this.renderOutcomeTracker?.start();
        },
        stop: async () => {
          this.renderOutcomeTracker?.stop();
        },
      });
    }
    const inventoryClient = getApiClient();
    this.inventoryRefillService = new InventoryRefillService(
      inventoryClient
        ? {
            installManager: this.installManager,
            cacheStore: this.cacheStore,
            platform: options.platform,
            sdkVersion,
            configStore: localStore,
            client: inventoryClient,
          }
        : {
            installManager: this.installManager,
            cacheStore: this.cacheStore,
            platform: options.platform,
            sdkVersion,
            configStore: localStore,
          },
    );
    this.heartbeatService = new HeartbeatService({
      installManager: this.installManager,
      eventQueue: this.eventQueue,
      cacheStore: this.cacheStore,
      platform: options.platform,
      sdkVersion,
      ...(options.timezone ? { timezone: options.timezone } : {}),
      ...(heartbeatClient ? { client: heartbeatClient } : {}),
      onSuccessfulHeartbeat: async () => {
        await this.telemetryService.record("runtime.heartbeat");
      },
      isOnline: () => this.networkMonitor.isOnline(),
      detectionStatsProvider: () => {
        const signals = this.agentDetectionService.getObservability();
        return {
          invalidTransitions: signals.invalidTransitions,
          unknownSessions: signals.unknownSessions,
          hookObservations: signals.hookObservations,
        };
      },
      ...(options.hookIntegrityProvider
        ? { hookIntegrityProvider: options.hookIntegrityProvider }
        : {}),
      displayMetricsProvider: () => {
        const metrics = this.displayMetricsService.getSnapshot();
        return {
          refillSuccesses: metrics.refillSuccesses,
          refillFailures: metrics.refillFailures,
          patchFailures: metrics.patchFailures,
          impressionsQueued: metrics.impressionsQueued,
          impressionsUploaded: metrics.impressionsUploaded,
          inventoryDisplays: metrics.inventoryDisplays,
          dismissals: metrics.dismissals,
          visibleDurationMs: metrics.visibleDurationMs,
        };
      },
    });
    this.registerService(this.heartbeatService);
    // Poll the public gate config once a minute; nudge the host when a newer build ships.
    const versionCheckClient = getApiClient() as ExtensionRequirementsClient | undefined;
    this.versionCheckService = new VersionCheckService({
      currentVersion: options.extensionVersion ?? sdkVersion,
      store: localStore,
      ...(versionCheckClient ? { client: versionCheckClient } : {}),
      onUpdateAvailable: (info) => {
        // The poll found the build below min_supported (server would 426 it): pause ad serving
        // now rather than waiting for the next register attempt to discover it.
        if (info.required) {
          this.markVersionRejected();
        }
        options.onUpdateAvailable?.(info);
      },
    });
    this.registerService(this.versionCheckService);
    this.agentDetectionService = new AgentDetectionService({
      eventQueue: this.eventQueue,
      installManager: this.installManager,
      platform: options.platform,
      sdkVersion,
      store: localStore,
      detectors: options.agentDetectors ?? [new ClaudeAdapter()],
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
      onImpressionSkip: (reason) => {
        this.displayMetricsService.recordImpressionSkip(reason);
      },
      onActivity: async (activity, sessionId, context) => {
        // Outdated build: stop rendering ads entirely (refill is already gated, but skip the
        // display so cached inventory doesn't surface either).
        if (this.versionRejected) {
          return;
        }

        if (activity === "waiting_started") {
          await this.refillInventoryIfNeeded();
          if (sessionId) {
            await this.displayLifecycleService.beginWaitingSession(sessionId);
          }
          return;
        }

        if (activity === "waiting_ended" || activity === "session_completed") {
          if (activity === "waiting_ended") {
            await this.refillInventoryIfNeeded();
          }

          await this.displayLifecycleService.completeWaitingSession(
            sessionId,
            context?.waitingPeriodMs === undefined
              ? {}
              : { waitingPeriodMs: context.waitingPeriodMs },
          );
        }
      },
    });
    this.registerService(this.agentDetectionService);
  }

  async start(): Promise<void> {
    try {
      await this.container.start();
      await this.displayLifecycleService.purgeExpiredAllocations();
      this.startedAt = new Date().toISOString();
      this.lastError = undefined;

      if (this.installManager.consumeNewInstallEvent()) {
        await this.telemetryService.record("runtime.installed");
      }

      await this.telemetryService.record("runtime.started");

      if (this.authSessionManager.getStatus() === "authenticated") {
        try {
          await this.ensureInstallRegistered();
          await this.refillInventoryIfNeeded();
          await this.heartbeatService.send();
        } catch {
          // ensureInstallRegistered records lastError
        }
      }
    } catch (error) {
      this.recordRuntimeError(error, "runtime.start");
      throw error;
    }
  }

  async refillInventoryIfNeeded(): Promise<void> {
    if (this.authSessionManager.getStatus() !== "authenticated") {
      return;
    }

    if (this.versionRejected) {
      // Outdated build: don't fetch ads the server would reject anyway, and that we won't show.
      return;
    }

    try {
      const response = await this.inventoryRefillService.refillIfNeeded();
      if (response) {
        this.lastRefillAt = new Date().toISOString();
        this.displayMetricsService.recordRefillSuccess();
        for (const allocation of response.allocations) {
          await this.displayEventService.recordInventoryReceived(allocation, response.batchId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "inventory refill failed";
      this.displayMetricsService.recordRefillFailure(message);
      this.recordRuntimeError(error, "inventory.refill");
      throw error;
    }
  }

  async ensureInstallRegistered(force = false): Promise<void> {
    if (this.authSessionManager.getStatus() !== "authenticated") {
      // Drop the guard so a later sign-in re-registers even if the install id is unchanged.
      this.registeredInstallId = undefined;
      return;
    }

    if (!this.installManager.getInstallId()) {
      await this.installManager.start();
    }

    const installId = this.installManager.getInstallId();
    if (!force && installId && this.registeredInstallId === installId) {
      return;
    }

    try {
      await this.installManager.registerInstall();
      this.registeredInstallId = installId;
    } catch (error) {
      this.recordRuntimeError(error, "install.register");
      // P1-25: an outdated/unofficial build is rejected with HTTP 426. Surface an
      // update prompt to the host and stop here — registration and ad serving stay
      // blocked until the user updates, rather than crashing the runtime.
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error as { status?: number }).status === 426
      ) {
        this.markVersionRejected();
        return;
      }
      throw error;
    }
  }

  /**
   * Mark this build as version-rejected and pause ad serving client-side. Idempotent. Fires
   * the host update prompt once. Called both reactively (HTTP 426 on register) and proactively
   * (the version-check poll finding the build below min_supported). Don't wait for the server
   * to reject every request — stop rendering/fetching ads here too.
   */
  private markVersionRejected(): void {
    if (this.versionRejected) {
      return;
    }
    this.versionRejected = true;
    this.onVersionRejected?.();
  }

  /** True once the build is known outdated; ad fetch + render are paused. */
  isAdServingPaused(): boolean {
    return this.versionRejected;
  }

  async stop(): Promise<void> {
    try {
      await this.container.stop();
    } catch (error) {
      this.recordRuntimeError(error, "runtime.stop");
      throw error;
    } finally {
      this.startedAt = undefined;
    }
  }

  /**
   * The account was banned (403 ``account_banned``). Stop the runtime, sign out, and drop any
   * cached ads so nothing keeps serving, then notify the host. Runs once and never throws —
   * it is fired (not awaited) from the API client mid-request.
   */
  private async handleAccountBanned(): Promise<void> {
    if (this.accountBanned) {
      return;
    }
    this.accountBanned = true;
    this.lastError = "account_banned";
    try {
      await this.stop();
    } catch {
      // stop() already recorded the error; banning must proceed regardless.
    }
    try {
      await this.authSessionManager.logout();
      await this.cacheStore.clear();
    } catch {
      // Best-effort sign-out/cache-clear; the 403 will keep any future calls blocked anyway.
    }
    this.onAccountBanned?.();
  }

  getStatus(): RuntimeStatus {
    const status: RuntimeStatus = {
      health: this.container.isStarted() ? "healthy" : "degraded",
      authStatus: this.authSessionManager.getStatus(),
      syncStatus: this.syncEngine.getSyncStatus(),
      networkStatus: this.networkMonitor.getStatus(),
      cacheSize: this.cacheStore.size(),
      queueSize: this.eventQueue.size(),
    };

    const installId = this.installManager.getInstallId();
    if (installId) {
      status.installId = installId;
    }

    if (this.startedAt) {
      status.startedAt = this.startedAt;
    }

    const lastSyncAt = this.syncEngine.getLastSyncAt();
    if (lastSyncAt) {
      status.lastSyncAt = lastSyncAt;
    }

    if (this.lastRefillAt) {
      status.lastRefillAt = this.lastRefillAt;
    }

    const lastHeartbeatAt = this.heartbeatService.getLastHeartbeatAt();
    if (lastHeartbeatAt) {
      status.lastHeartbeatAt = lastHeartbeatAt;
    }

    const lastError =
      this.lastError ?? this.syncEngine.getLastSyncError() ?? this.heartbeatService.getLastError();
    if (lastError) {
      status.lastError = lastError;
    }

    status.signals = this.agentDetectionService.getObservability();
    status.display = this.buildDisplayObservability();

    return status;
  }

  private buildDisplayObservability() {
    const metrics = this.displayMetricsService.getSnapshot();
    return {
      pendingInventoryEvents: this.eventQueue.countUploadableByEventType((eventType) =>
        eventType.startsWith("inventory."),
      ),
      pendingRenderEvents: this.eventQueue.countUploadableByEventType((eventType) =>
        eventType.startsWith("render."),
      ),
      ...this.displayLifecycleService.getDisplayStatusSync(),
      refillSuccesses: metrics.refillSuccesses,
      refillFailures: metrics.refillFailures,
      emptyCacheEvents: metrics.emptyCacheEvents,
      expiredPurged: metrics.expiredPurged,
      inventoryDisplays: metrics.inventoryDisplays,
      dismissals: metrics.dismissals,
      impressions: metrics.impressionsQueued,
      clicks: metrics.clicksQueued,
      impressionsQueued: metrics.impressionsQueued,
      impressionsUploaded: metrics.impressionsUploaded,
      impressionsVerified: metrics.impressionsVerified,
      impressionsRejected: metrics.impressionsRejected,
      clicksQueued: metrics.clicksQueued,
      clicksUploaded: metrics.clicksUploaded,
      clicksVerified: metrics.clicksVerified,
      clicksRejected: metrics.clicksRejected,
      visibleDurationMs: metrics.visibleDurationMs,
      lifecycleTimeouts: metrics.lifecycleTimeouts,
      renderErrors: metrics.renderErrors,
      patchFailures: metrics.patchFailures,
      ...(metrics.lastRefillError ? { lastRefillError: metrics.lastRefillError } : {}),
      ...(metrics.lastImpressionSkipReason
        ? { lastImpressionSkipReason: metrics.lastImpressionSkipReason }
        : {}),
    };
  }

  getCredentialVault(): CredentialVault {
    return this.credentialVault;
  }

  getAuthSessionManager(): AuthSessionManager {
    return this.authSessionManager;
  }

  getCacheStore(): CacheStore {
    return this.cacheStore;
  }

  getDiagnosticsService(): DiagnosticsService {
    return this.diagnosticsService;
  }

  getEventQueue(): EventQueue {
    return this.eventQueue;
  }

  getHeartbeatService(): HeartbeatService {
    return this.heartbeatService;
  }

  getTelemetryService(): TelemetryService {
    return this.telemetryService;
  }

  getInstallManager(): InstallManager {
    return this.installManager;
  }

  getSyncEngine(): SyncEngine {
    return this.syncEngine;
  }

  getAgentDetectionService(): AgentDetectionService {
    return this.agentDetectionService;
  }

  getDisplayLifecycleService(): DisplayLifecycleService {
    return this.displayLifecycleService;
  }

  getDisplayMetricsService(): DisplayMetricsService {
    return this.displayMetricsService;
  }

  private registerService(service: RuntimeService): void {
    this.container.register(service);
  }

  private recordRuntimeError(error: unknown, source: string): void {
    const message = error instanceof Error ? error.message : "Unknown runtime error";
    this.lastError = message;
    this.diagnosticsService.recordError(message, source);
  }
}
