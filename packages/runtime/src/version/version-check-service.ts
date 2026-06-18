import type { RuntimeService } from "../runtime/service";
import type { KeyValueStore } from "../storage/key-value-store";
import { isVersionOlder } from "./version-compare";

// Persisted (across restarts) record of the last update prompt, so the nag cadence survives
// window reloads rather than resetting every session.
const LAST_PROMPT_KEY = "version-check:last-prompt";
const DEFAULT_PROMPT_COOLDOWN_MS = 60 * 60_000; // 1 hour

interface LastPromptRecord {
  version: string;
  promptedAt: number;
}

/** Gate config from GET /v1/runtime/extension-requirements (camelCased). */
export interface ExtensionRequirements {
  gateEnabled: boolean;
  publisher: string;
  extensionId: string;
  latestVersion: string;
  minSupportedVersion: string;
}

export interface ExtensionRequirementsClient {
  getExtensionRequirements(): Promise<ExtensionRequirements>;
}

export interface UpdateAvailableInfo {
  /** The newest version the server advertises. */
  latestVersion: string;
  /**
   * True when the running build is below min_supported_version (the server would reject it
   * with HTTP 426). The forced/paused case is normally surfaced by the register path; the
   * poll passes this through so the host can word its prompt accordingly.
   */
  required: boolean;
}

export interface VersionCheckScheduler {
  setInterval(handler: () => void, timeoutMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: VersionCheckScheduler = {
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

export interface VersionCheckServiceOptions {
  /** The running build's version (the extension's manifest version). */
  currentVersion: string;
  client?: ExtensionRequirementsClient;
  intervalMs?: number;
  /** Minimum gap between repeat prompts for the same version. Defaults to 1 hour. */
  promptCooldownMs?: number;
  /** Durable store for the last-prompt timestamp, so the cooldown survives restarts. */
  store?: KeyValueStore;
  scheduler?: VersionCheckScheduler;
  now?: () => number;
  onUpdateAvailable?: (info: UpdateAvailableInfo) => void;
}

/**
 * Polls the public extension-requirements endpoint and, when a newer build exists, fires a
 * single update prompt per discovered version. Proactive companion to the reactive HTTP 426
 * gate on /v1/runtime/register: the gate pauses an outdated build, this nudges before that.
 */
export class VersionCheckService implements RuntimeService {
  readonly name = "version-check-service";

  private readonly intervalMs: number;
  private readonly promptCooldownMs: number;
  private readonly scheduler: VersionCheckScheduler;
  private readonly now: () => number;
  private intervalHandle: unknown;
  // Last prompt we showed (version + when). Hydrated from the durable store on first check so
  // the hourly cadence persists across window reloads; mirrored in memory thereafter.
  private lastPrompt: LastPromptRecord | undefined;
  private hydrated = false;
  private lastError: string | undefined;

  constructor(private readonly options: VersionCheckServiceOptions) {
    this.intervalMs = options.intervalMs ?? 60_000;
    this.promptCooldownMs = options.promptCooldownMs ?? DEFAULT_PROMPT_COOLDOWN_MS;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.now = options.now ?? (() => Date.now());
  }

  async start(): Promise<void> {
    await this.check();
    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.check();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async check(): Promise<void> {
    if (!this.options.client) {
      return;
    }

    try {
      await this.hydrate();
      const requirements = await this.options.client.getExtensionRequirements();
      this.lastError = undefined;

      const current = this.options.currentVersion;
      if (!isVersionOlder(current, requirements.latestVersion)) {
        return; // Up to date (or ahead of the advertised latest).
      }

      const latest = requirements.latestVersion;
      const required =
        requirements.gateEnabled && isVersionOlder(current, requirements.minSupportedVersion);

      // A newer version than we last nagged about is fresh news → prompt now. Otherwise honor
      // the cooldown so we nag at most once per window (default hourly), not every poll tick.
      const isNewVersion = this.lastPrompt?.version !== latest;
      const cooledDown =
        this.lastPrompt === undefined ||
        this.now() - this.lastPrompt.promptedAt >= this.promptCooldownMs;
      if (!isNewVersion && !cooledDown) {
        return;
      }

      this.lastPrompt = { version: latest, promptedAt: this.now() };
      await this.options.store?.set(LAST_PROMPT_KEY, this.lastPrompt);
      this.options.onUpdateAvailable?.({ latestVersion: latest, required });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "version check failed";
    }
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) {
      return;
    }
    this.hydrated = true;
    if (!this.options.store) {
      return;
    }
    this.lastPrompt = await this.options.store.get<LastPromptRecord>(LAST_PROMPT_KEY);
  }
}
