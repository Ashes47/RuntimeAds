import type { KeyValueStore } from "../storage/key-value-store";

const STATE_KEY = "runtimeads.render.frequency";
/** Aligns with IMPRESSION_VIEW_THRESHOLD_MS — one impression gate per qualifying wait. */
export const MIN_RENDER_INTERVAL_MS = 5000;

export interface FrequencyGuardState {
  lastRenderAt: string | null;
  hiddenForSession: boolean;
  dismissedManually: boolean;
}

export interface FrequencyGuardOptions {
  store: KeyValueStore;
  minCooldownMs?: number;
  now?: () => number;
}

type StoredFrequencyGuardState = Partial<FrequencyGuardState> & {
  renderTimestamps?: string[];
};

export class FrequencyGuard {
  private readonly minCooldownMs: number;
  private readonly now: () => number;
  private cachedState: FrequencyGuardState = {
    lastRenderAt: null,
    hiddenForSession: false,
    dismissedManually: false,
  };

  constructor(private readonly options: FrequencyGuardOptions) {
    this.minCooldownMs = options.minCooldownMs ?? MIN_RENDER_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async canRender(): Promise<boolean> {
    const state = await this.load();
    if (state.hiddenForSession) {
      return false;
    }

    if (state.lastRenderAt) {
      const lastRenderAt = Date.parse(state.lastRenderAt);
      if (lastRenderAt > 0 && this.now() - lastRenderAt < this.minCooldownMs) {
        return false;
      }
    }

    return true;
  }

  async recordRender(at = new Date(this.now()).toISOString()): Promise<void> {
    const state = await this.load();
    await this.persist({
      ...state,
      lastRenderAt: at,
    });
  }

  async isUserSuppressed(): Promise<boolean> {
    const state = await this.load();
    return state.dismissedManually || state.hiddenForSession;
  }

  isUserSuppressedSync(): boolean {
    return this.cachedState.dismissedManually || this.cachedState.hiddenForSession;
  }

  async dismissForSession(): Promise<void> {
    const state = await this.load();
    await this.persist({
      ...state,
      hiddenForSession: true,
      dismissedManually: true,
    });
  }

  /** Clears manual dismiss once no agent is waiting (next wait can show ads again). */
  async clearUserSuppress(): Promise<void> {
    const state = await this.load();
    if (!state.dismissedManually) {
      return;
    }

    await this.persist({
      ...state,
      hiddenForSession: false,
      dismissedManually: false,
    });
  }

  async endSession(): Promise<void> {
    const state = await this.load();
    if (state.dismissedManually) {
      return;
    }

    await this.persist({
      ...state,
      hiddenForSession: false,
    });
  }

  private async load(): Promise<FrequencyGuardState> {
    const stored = await this.options.store.get<StoredFrequencyGuardState>(STATE_KEY);
    const legacyTimestamps = stored?.renderTimestamps ?? [];
    const lastRenderAt =
      stored?.lastRenderAt ??
      (legacyTimestamps.length > 0 ? legacyTimestamps[legacyTimestamps.length - 1]! : null) ??
      null;
    this.cachedState = {
      lastRenderAt,
      hiddenForSession: stored?.hiddenForSession ?? false,
      dismissedManually: stored?.dismissedManually ?? false,
    };
    return this.cachedState;
  }

  private async persist(state: FrequencyGuardState): Promise<void> {
    this.cachedState = state;
    await this.options.store.set(STATE_KEY, state);
  }
}
