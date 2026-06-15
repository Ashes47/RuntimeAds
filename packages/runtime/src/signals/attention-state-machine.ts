import type { AttentionState } from "@runtimeads/sdk-contracts";

const VALID_TRANSITIONS: Record<AttentionState, AttentionState[]> = {
  idle: ["working"],
  working: ["waiting", "complete"],
  waiting: ["working", "complete"],
  complete: ["idle"],
};

export class AttentionStateMachine {
  private state: AttentionState = "idle";
  private stateEnteredAt: string;

  constructor(initialState: AttentionState = "idle", enteredAt?: string) {
    this.state = initialState;
    this.stateEnteredAt = enteredAt ?? new Date().toISOString();
  }

  getState(): AttentionState {
    return this.state;
  }

  getStateEnteredAt(): string {
    return this.stateEnteredAt;
  }

  canTransition(next: AttentionState): boolean {
    return VALID_TRANSITIONS[this.state].includes(next);
  }

  transition(next: AttentionState, occurredAt: string): number {
    if (!this.canTransition(next)) {
      throw new InvalidAttentionTransitionError(this.state, next);
    }

    const durationMs = Math.max(0, Date.parse(occurredAt) - Date.parse(this.stateEnteredAt));
    this.state = next;
    this.stateEnteredAt = occurredAt;
    return durationMs;
  }

  restore(state: AttentionState, stateEnteredAt: string): void {
    this.state = state;
    this.stateEnteredAt = stateEnteredAt;
  }
}

export class InvalidAttentionTransitionError extends Error {
  constructor(
    readonly from: AttentionState,
    readonly to: AttentionState,
  ) {
    super(`Invalid attention transition: ${from} -> ${to}`);
  }
}

export function activityToTargetState(activity: AgentActivityKind): AttentionState | undefined {
  switch (activity) {
    case "session_started":
      return "working";
    case "waiting_started":
      return "waiting";
    case "waiting_ended":
      return "working";
    case "session_completed":
      return "complete";
    default:
      return undefined;
  }
}

export type AgentActivityKind =
  | "session_started"
  | "working_started"
  | "waiting_started"
  | "waiting_ended"
  | "session_completed";
