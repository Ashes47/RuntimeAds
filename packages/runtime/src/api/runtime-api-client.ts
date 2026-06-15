import type { CachedAllocation, Platform } from "@runtimeads/sdk-contracts";

import type { QueuedEvent } from "../events/event-queue";

export interface RuntimeApiClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  accessTokenProvider?: () => Promise<string | undefined>;
  refreshAccessToken?: () => Promise<string | undefined>;
  maxRetries?: number;
}

export interface RegisterInstallRequest {
  installId: string;
  platform: Platform;
  sdkVersion: string;
  os?: string;
  // P1-20: IANA timezone (e.g. "America/New_York") from the host's Intl settings.
  timezone?: string;
  // P1-25 extension version gate metadata.
  extensionId?: string;
  extensionVersion?: string;
  publisher?: string;
}

export interface DetectionStatsPayload {
  invalidTransitions: number;
  unknownSessions: number;
  hookObservations: number;
}

export interface HookIntegrityPayload {
  ok: boolean;
  mismatchedFiles: string[];
  fileHashes?: Record<string, string>;
  manifestMtime?: string;
}

export interface DisplayMetricsPayload {
  refillSuccesses: number;
  refillFailures: number;
  patchFailures: number;
  impressionsQueued: number;
  impressionsUploaded: number;
  inventoryDisplays: number;
  dismissals: number;
  visibleDurationMs: number;
}

export interface HeartbeatRequest {
  installId: string;
  platform: Platform;
  sdkVersion: string;
  cacheSize: number;
  queueSize: number;
  online: boolean;
  // P1-20: IANA timezone, sent so already-registered installs also get geo populated.
  timezone?: string;
  detectionStats?: DetectionStatsPayload;
  hookIntegrity?: HookIntegrityPayload;
  displayMetrics?: DisplayMetricsPayload;
}

export interface InventoryRefillRequest {
  installId: string;
  platform: Platform;
  sdkVersion: string;
  cacheRemaining: number;
  cacheAgeSeconds?: number;
  knownConfigVersion?: string;
  forceRefresh?: boolean;
  discardedAllocationIds?: string[];
}

export interface InventoryRefillResponse {
  batchId: string;
  mode: "append" | "replace";
  backendConfigVersion: string;
  targetCacheSize: number;
  refillThreshold: number;
  leaseExpiresAt: string;
  allocations: CachedAllocation[];
}

export interface GoogleLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export interface EventAccountingTraceResponse {
  eventId: string;
  eventType: string | null;
  processed: boolean;
  verifiedImpression: boolean;
  verifiedClick: boolean;
  rejection: boolean;
}

export class RuntimeApiClient {
  private readonly fetcher: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: RuntimeApiClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async loginWithGoogle(googleToken: string): Promise<GoogleLoginResponse> {
    const response = await this.postJson<{
      access_token: string;
      refresh_token: string;
      user: {
        id: string;
        email: string;
        role: string;
      };
    }>("/v1/auth/google", {
      google_token: googleToken,
    });

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      user: response.user,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const response = await this.postJson<{ access_token: string }>("/v1/auth/refresh", {
      refresh_token: refreshToken,
    });

    return { accessToken: response.access_token };
  }

  /** Exchange a one-time OAuth callback code for tokens (keeps tokens out of the redirect URL). */
  async redeemAuthCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    developerId: string;
    role: string;
  }> {
    const response = await this.postJson<{
      access_token: string;
      refresh_token: string;
      developer_id: string;
      role: string;
    }>("/v1/auth/callback/redeem", { code });

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      developerId: response.developer_id,
      role: response.role,
    };
  }

  async registerInstall(request: RegisterInstallRequest): Promise<void> {
    await this.post("/v1/runtime/register", {
      install_id: request.installId,
      platform: request.platform,
      sdk_version: request.sdkVersion,
      ...(request.os ? { os: request.os } : {}),
      ...(request.timezone ? { timezone: request.timezone } : {}),
      ...(request.extensionId ? { extension_id: request.extensionId } : {}),
      ...(request.extensionVersion ? { extension_version: request.extensionVersion } : {}),
      ...(request.publisher ? { publisher: request.publisher } : {}),
    });
  }

  async heartbeat(request: HeartbeatRequest): Promise<void> {
    await this.post("/v1/runtime/heartbeat", {
      install_id: request.installId,
      platform: request.platform,
      sdk_version: request.sdkVersion,
      cache_size: request.cacheSize,
      queue_size: request.queueSize,
      online: request.online,
      ...(request.timezone ? { timezone: request.timezone } : {}),
      ...(request.detectionStats
        ? {
            detection_stats: {
              invalid_transitions: request.detectionStats.invalidTransitions,
              unknown_sessions: request.detectionStats.unknownSessions,
              hook_observations: request.detectionStats.hookObservations,
            },
          }
        : {}),
      ...(request.hookIntegrity
        ? {
            hook_integrity: {
              ok: request.hookIntegrity.ok,
              mismatched_files: request.hookIntegrity.mismatchedFiles,
              ...(request.hookIntegrity.fileHashes
                ? { file_hashes: request.hookIntegrity.fileHashes }
                : {}),
              ...(request.hookIntegrity.manifestMtime
                ? { manifest_mtime: request.hookIntegrity.manifestMtime }
                : {}),
            },
          }
        : {}),
      ...(request.displayMetrics
        ? {
            display_metrics: {
              refill_successes: request.displayMetrics.refillSuccesses,
              refill_failures: request.displayMetrics.refillFailures,
              patch_failures: request.displayMetrics.patchFailures,
              impressions_queued: request.displayMetrics.impressionsQueued,
              impressions_uploaded: request.displayMetrics.impressionsUploaded,
              inventory_displays: request.displayMetrics.inventoryDisplays,
              dismissals: request.displayMetrics.dismissals,
              visible_duration_ms: request.displayMetrics.visibleDurationMs,
            },
          }
        : {}),
    });
  }

  async refillInventory(request: InventoryRefillRequest): Promise<InventoryRefillResponse> {
    const response = await this.postJson<{
      batch_id: string;
      mode: "append" | "replace";
      backend_config_version: string;
      target_cache_size: number;
      refill_threshold: number;
      lease_expires_at: string;
      allocations: Array<{
        allocation_id: string;
        campaign_id: string;
        brand: string;
        icon_url: string | null;
        headline: string;
        body?: string;
        cta?: string;
        destination_url: string;
        cpm_cents?: number;
        expires_at: string;
      }>;
    }>("/v1/inventory/refill", {
      install_id: request.installId,
      platform: request.platform,
      surface: "vscode_status_bar",
      agent: "claude_code",
      cache_remaining: request.cacheRemaining,
      cache_age_seconds: request.cacheAgeSeconds ?? 0,
      ...(request.knownConfigVersion ? { known_config_version: request.knownConfigVersion } : {}),
      force_refresh: request.forceRefresh ?? false,
      discarded_allocation_ids: request.discardedAllocationIds ?? [],
      sdk_version: request.sdkVersion,
    });

    return {
      batchId: response.batch_id,
      mode: response.mode,
      backendConfigVersion: response.backend_config_version,
      targetCacheSize: response.target_cache_size,
      refillThreshold: response.refill_threshold,
      leaseExpiresAt: response.lease_expires_at,
      allocations: response.allocations.map((allocation) => ({
        allocationId: allocation.allocation_id,
        campaignId: allocation.campaign_id,
        brand: allocation.brand,
        headline: allocation.headline,
        ...(allocation.icon_url ? { iconUrl: allocation.icon_url } : {}),
        ...(allocation.body ? { body: allocation.body } : {}),
        ...(allocation.cta ? { cta: allocation.cta } : {}),
        destinationUrl: allocation.destination_url,
        cpmCents: allocation.cpm_cents ?? 0,
        expiresAt: allocation.expires_at,
      })),
    };
  }

  async uploadEvents(events: QueuedEvent[]): Promise<void> {
    const signalEvents = events.filter((record) => isAgentSignalEvent(record.event.eventType));
    const operationalEvents = events.filter(
      (record) => !isAgentSignalEvent(record.event.eventType),
    );
    const batchId = globalThis.crypto.randomUUID();

    if (signalEvents.length > 0) {
      await this.post("/v1/signals/batch", {
        batch_id: batchId,
        events: signalEvents.map((record) => toApiEvent(record)),
      });
    }

    if (operationalEvents.length > 0) {
      await this.post("/v1/events/batch", {
        batch_id: batchId,
        events: operationalEvents.map((record) => toApiEvent(record)),
      });
    }
  }

  async getEventAccountingTrace(eventId: string): Promise<EventAccountingTraceResponse> {
    const response = await this.getJson<{
      event_id: string;
      event_type: string | null;
      processed: boolean;
      verified_impression: unknown | null;
      verified_click: unknown | null;
      rejection: unknown | null;
    }>(`/v1/accounting/events/${eventId}/trace`);

    return {
      eventId: response.event_id,
      eventType: response.event_type,
      processed: response.processed,
      verifiedImpression: response.verified_impression != null,
      verifiedClick: response.verified_click != null,
      rejection: response.rejection != null,
    };
  }

  private async getJson<TResponse>(path: string): Promise<TResponse> {
    return this.requestJson<TResponse>("GET", path);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    await this.postJson(path, body);
  }

  private async postJson<TResponse = unknown>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<TResponse> {
    return this.requestJson<TResponse>("POST", path, body);
  }

  private async requestJson<TResponse>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<TResponse> {
    let accessToken = await this.options.accessTokenProvider?.();
    let lastError: unknown;
    // Never trigger a token refresh for the auth endpoints themselves — a 401 from
    // /v1/auth/refresh means the refresh token is dead, and refreshing again would recurse
    // (refresh → 401 → refresh → …), which is what spammed the API on a stale token.
    const isAuthPath = path.startsWith("/v1/auth/");

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.sendJson<TResponse>(method, path, body, accessToken);
      } catch (error) {
        lastError = error;

        if (
          !isAuthPath &&
          error instanceof RuntimeApiError &&
          error.status === 401 &&
          attempt === 0
        ) {
          accessToken = await this.options.refreshAccessToken?.();
          if (accessToken) {
            continue;
          }
        }

        if (!(error instanceof RuntimeApiError) || !error.retryable || attempt >= this.maxRetries) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async sendJson<TResponse>(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | undefined,
    accessToken?: string,
  ): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Surface the server's error body (e.g. FastAPI 422 validation detail naming the
        // offending field) instead of a generic status — otherwise callers log an opaque
        // "Unknown runtime error" and the root cause is invisible.
        let detail: string | undefined;
        try {
          detail = (await response.text()).slice(0, 1000) || undefined;
        } catch {
          detail = undefined;
        }
        throw new RuntimeApiError(response.status, path, detail);
      }

      return (await response.json()) as TResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class RuntimeApiError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    readonly path?: string,
    readonly detail?: string,
  ) {
    const location = path ? ` (${path})` : "";
    const body = detail ? ` — ${detail}` : "";
    super(`Runtime API request failed: ${status}${location}${body}`);
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

function isAgentSignalEvent(eventType: string): boolean {
  return eventType.startsWith("agent.");
}

function toApiEvent(record: QueuedEvent): Record<string, unknown> {
  const event = record.event;

  return {
    event_id: event.eventId,
    event_type: event.eventType,
    event_version: event.eventVersion,
    occurred_at: event.occurredAt,
    created_at: event.createdAt,
    developer_id: event.developerId,
    install_id: event.installId,
    session_id: event.sessionId,
    platform: event.platform,
    agent: event.agent,
    sdk_version: event.sdkVersion,
    payload: event.payload,
  };
}
