import type { KeyValueStore } from "../storage/key-value-store";

const STATE_KEY = "runtimeads.render.frequency";

export interface FrequencyGuardState {
  lastRenderAt: string | null;
  hiddenForSession: boolean;
  dismissedManually: boolean;
}

export interface FrequencyGuardOptions {
  store: KeyValueStore;
  now?: () => number;
}

type StoredFrequencyGuardState = Partial<FrequencyGuardState> & {
  renderTimestamps?: string[];
};

export class FrequencyGuard {
  private readonly now: () => number;
  private cachedState: FrequencyGuardState = {
    lastRenderAt: null,
    hiddenForSession: false,
    dismissedManually: false,
  };

  constructor(private readonly options: FrequencyGuardOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async canRender(): Promise<boolean> {
    // No time cooldown between ads — an ad fills the slot on every qualifying wait, so the display
    // never goes blank between back-to-back waits. The only block is a manual user dismiss for the
    // session. The 5s threshold lives in the display lifecycle (IMPRESSION_VIEW_THRESHOLD_MS) and
    // decides only whether a *view* counts as a valid impression, not whether to render.
    const state = await this.load();
    return !state.hiddenForSession;
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
