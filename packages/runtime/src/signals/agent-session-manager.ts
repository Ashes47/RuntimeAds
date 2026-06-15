import type { Agent, AgentSessionRecord, AttentionState } from "@runtimeads/sdk-contracts";

import type { KeyValueStore } from "../storage/key-value-store";
import { AttentionStateMachine } from "./attention-state-machine";

const ACTIVE_SESSIONS_KEY = "runtimeads.agent_sessions.active";

export interface ManagedAgentSession extends AgentSessionRecord {
  machine: AttentionStateMachine;
  /** Set when PreToolUse fires during an existing wait (e.g. after UserPromptSubmit). */
  toolWaitStartedAt?: string;
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, ManagedAgentSession>();
  private loaded = false;

  constructor(private readonly store?: KeyValueStore) {}

  async start(): Promise<void> {
    await this.load();
  }

  async stop(): Promise<void> {
    await this.persist();
  }

  listSessions(): AgentSessionRecord[] {
    return [...this.sessions.values()].filter((session) => !session.endedAt).map(toSessionRecord);
  }

  getSession(sessionId: string): AgentSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    return session ? toSessionRecord(session) : undefined;
  }

  getToolWaitStartedAt(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.toolWaitStartedAt;
  }

  async recordToolWaitStart(sessionId: string, occurredAt: string): Promise<void> {
    await this.load();

    const session = this.sessions.get(sessionId);
    if (!session || session.endedAt) {
      return;
    }

    session.toolWaitStartedAt = occurredAt;
  }

  async clearToolWaitStart(sessionId: string): Promise<void> {
    await this.load();

    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    delete session.toolWaitStartedAt;
  }

  async openSession(input: {
    sessionId: string;
    agent: Agent;
    terminalId?: string;
    occurredAt: string;
  }): Promise<ManagedAgentSession> {
    await this.load();

    const existing = this.sessions.get(input.sessionId);
    if (existing && !existing.endedAt) {
      return existing;
    }

    const machine = new AttentionStateMachine("idle", input.occurredAt);
    machine.transition("working", input.occurredAt);

    const session: ManagedAgentSession = {
      sessionId: input.sessionId,
      agent: input.agent,
      ...(input.terminalId ? { terminalId: input.terminalId } : {}),
      startedAt: input.occurredAt,
      state: machine.getState(),
      stateEnteredAt: machine.getStateEnteredAt(),
      workingMs: 0,
      waitingMs: 0,
      machine,
    };

    this.sessions.set(input.sessionId, session);
    await this.persist();
    return session;
  }

  async applyTransition(input: {
    sessionId: string;
    nextState: AttentionState;
    occurredAt: string;
  }): Promise<ManagedAgentSession> {
    await this.load();

    const session = this.sessions.get(input.sessionId);
    if (!session || session.endedAt) {
      throw new Error(`Unknown active agent session: ${input.sessionId}`);
    }

    const fromState = session.machine.getState();
    const durationMs = session.machine.transition(input.nextState, input.occurredAt);
    if (fromState === "working") {
      session.workingMs += durationMs;
    } else if (fromState === "waiting") {
      session.waitingMs += durationMs;
    }

    session.state = session.machine.getState();
    session.stateEnteredAt = session.machine.getStateEnteredAt();

    if (input.nextState === "complete") {
      session.endedAt = input.occurredAt;
      session.machine.transition("idle", input.occurredAt);
      session.state = "idle";
      session.stateEnteredAt = input.occurredAt;
    }

    await this.persist();
    return session;
  }

  async recoverOrphanSessions(now = new Date().toISOString()): Promise<number> {
    await this.load();

    let recovered = 0;
    for (const session of this.sessions.values()) {
      if (session.endedAt) {
        continue;
      }

      const staleMs = nowMs(now) - nowMs(session.stateEnteredAt);
      if (staleMs < 6 * 60 * 60 * 1000) {
        continue;
      }

      session.endedAt = now;
      session.state = "idle";
      session.stateEnteredAt = now;
      recovered += 1;
    }

    if (recovered > 0) {
      await this.persist();
    }

    return recovered;
  }

  private async load(): Promise<void> {
    if (this.loaded || !this.store) {
      this.loaded = true;
      return;
    }

    const stored = (await this.store.get<AgentSessionRecord[]>(ACTIVE_SESSIONS_KEY)) ?? [];
    for (const record of stored) {
      if (record.endedAt) {
        continue;
      }

      const machine = new AttentionStateMachine(record.state, record.stateEnteredAt);
      this.sessions.set(record.sessionId, {
        ...record,
        machine,
      });
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (!this.store) {
      return;
    }

    const active = [...this.sessions.values()]
      .filter((session) => !session.endedAt)
      .map(toSessionRecord);
    await this.store.set(ACTIVE_SESSIONS_KEY, active);
  }
}

function toSessionRecord(session: ManagedAgentSession): AgentSessionRecord {
  return {
    sessionId: session.sessionId,
    agent: session.agent,
    ...(session.terminalId ? { terminalId: session.terminalId } : {}),
    startedAt: session.startedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    state: session.state,
    stateEnteredAt: session.stateEnteredAt,
    workingMs: session.workingMs,
    waitingMs: session.waitingMs,
  };
}

function nowMs(value: string): number {
  return Date.parse(value);
}
