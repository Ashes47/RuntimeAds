export type Platform = "vscode" | "cursor";
export type Agent = "claude_code" | "codex_cli";

export type AttentionState = "idle" | "working" | "waiting" | "complete";

export type AgentDetectionMethod = "hook" | "process" | "terminal" | "manual" | "unknown";

export type AgentWaitingReason =
  | "thinking"
  | "tool_running"
  | "searching"
  | "generating"
  | "unknown";

export type AgentSignalEventType =
  | "agent.session_started"
  | "agent.working_started"
  | "agent.waiting_started"
  | "agent.waiting_ended"
  | "agent.session_completed";

export interface AgentSessionRecord {
  sessionId: string;
  agent: Agent;
  terminalId?: string;
  startedAt: string;
  endedAt?: string;
  state: AttentionState;
  stateEnteredAt: string;
  workingMs: number;
  waitingMs: number;
}

export interface AgentActivityObservation {
  agent: Agent;
  activity:
    | "session_started"
    | "working_started"
    | "waiting_started"
    | "waiting_ended"
    | "session_completed";
  occurredAt: string;
  sessionId?: string;
  terminalId?: string;
  detectionMethod?: AgentDetectionMethod;
  waitingReason?: AgentWaitingReason;
}

export interface SignalObservabilitySnapshot {
  observationsReceived: number;
  signalsGenerated: number;
  invalidTransitions: number;
  unknownSessions: number;
  activeSessions: number;
  hookObservations: number;
}

export interface SignalPipelineMetrics {
  batchesReceived: number;
  signalsAccepted: number;
  signalsRejected: number;
  sessionsDetected: number;
  waitingSignals: number;
  aggregationErrors: number;
  totalWaitingSeconds: number;
  totalInventoryOpportunities: number;
  averageLatencyMs: number;
  rejectionReasons: Record<string, number>;
  lastIngestAt?: string;
}

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  createdAt: string;
  developerId?: string;
  installId: string;
  sessionId?: string;
  platform: Platform;
  agent?: Agent;
  sdkVersion: string;
  payload: TPayload;
}

/** Kickbacks-aligned render surfaces (EPIC-04). */
export type RenderSurface =
  | "claude_overlay"
  | "codex_overlay"
  | "cli_spinner_verb"
  | "cli_status_line"
  | "codex_cli_banner"
  | "vscode_status_bar";

/**
 * Canonical user-facing names + "where it renders" descriptions for each surface.
 * Single source of truth shared by the web dashboard and the extension (EPIC-15).
 */
export const SURFACE_META: Record<RenderSurface, { label: string; description: string }> = {
  claude_overlay: {
    label: "Claude Code panel",
    description: "The Claude Code panel (VS Code / Cursor), over the spinner row.",
  },
  codex_overlay: {
    label: "Codex panel",
    description: 'The Codex panel, over the "thinking shimmer" row.',
  },
  vscode_status_bar: {
    label: "Editor status bar",
    description: "The editor status bar (bottom), while an agent waits.",
  },
  cli_spinner_verb: {
    label: "Claude CLI spinner",
    description: "The Claude CLI spinner (terminal `claude`).",
  },
  cli_status_line: {
    label: "Claude CLI status line",
    description: "The Claude CLI status line (bottom of `claude`).",
  },
  codex_cli_banner: {
    label: "Codex CLI banner",
    description: "The Codex CLI startup line (terminal `codex`).",
  },
};

export function surfaceLabel(code: string): string {
  return (SURFACE_META as Record<string, { label: string }>)[code]?.label ?? code;
}

export function surfaceDescription(code: string): string | null {
  return (SURFACE_META as Record<string, { description: string }>)[code]?.description ?? null;
}

export type InventoryDismissReason = "manual" | "waiting_ended" | "timeout" | "surface_closed";

export interface CachedAllocation {
  allocationId: string;
  campaignId: string;
  brand: string;
  /** Public URL to the advertiser-uploaded campaign icon, when set. */
  iconUrl?: string;
  headline: string;
  body?: string;
  cta?: string;
  destinationUrl: string;
  /** Advertiser bid per 1,000 impressions, in cents. Used for accounting metadata only. */
  cpmCents: number;
  expiresAt: string;
}

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface RuntimeStatus {
  health: "healthy" | "degraded" | "offline";
  authStatus: "unauthenticated" | "authenticated" | "expired" | "refreshing" | "logged_out";
  syncStatus?: SyncStatus;
  networkStatus?: "online" | "offline" | "unknown";
  installId?: string;
  cacheSize: number;
  queueSize: number;
  startedAt?: string;
  lastSyncAt?: string;
  lastHeartbeatAt?: string;
  lastRefillAt?: string;
  lastError?: string;
  signals?: SignalObservabilitySnapshot;
  display?: DisplayObservabilitySnapshot;
}

export interface DisplayObservabilitySnapshot {
  userSuppressed: boolean;
  activeSession: boolean;
  cacheDisplayed: number;
  pendingInventoryEvents: number;
  pendingRenderEvents: number;
  sessionState: "idle" | "pending" | "visible" | "dismissed" | "completed";
  refillSuccesses: number;
  refillFailures: number;
  emptyCacheEvents: number;
  expiredPurged: number;
  inventoryDisplays: number;
  dismissals: number;
  impressions: number;
  clicks: number;
  impressionsQueued: number;
  impressionsUploaded: number;
  impressionsVerified: number;
  impressionsRejected: number;
  clicksQueued: number;
  clicksUploaded: number;
  clicksVerified: number;
  clicksRejected: number;
  visibleDurationMs: number;
  lifecycleTimeouts: number;
  renderErrors: number;
  patchFailures: number;
  lastRefillError?: string;
  lastImpressionSkipReason?: string;
}
