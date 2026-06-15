import type {
  Agent,
  AgentActivityObservation,
  AgentSessionRecord,
} from "@runtimeads/sdk-contracts";

import type { AgentDetector } from "./agent-detector";

export interface ProcessClaudeDetectorOptions {
  isProcessRunning?: () => boolean;
  lastHookActivityAt?: () => number | undefined;
  idFactory?: () => string;
}

export class ProcessClaudeDetector implements AgentDetector {
  readonly agent: Agent = "claude_code";
  readonly name = "process-claude-detector";

  private running = false;
  private activeSessionId: string | undefined;

  constructor(private readonly options: ProcessClaudeDetectorOptions = {}) {}

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.activeSessionId = undefined;
  }

  async detect(): Promise<AgentActivityObservation[]> {
    if (!this.running || !this.options.isProcessRunning?.()) {
      if (this.activeSessionId) {
        const completed = this.buildObservation("session_completed", this.activeSessionId);
        this.activeSessionId = undefined;
        return [completed];
      }
      return [];
    }

    const lastHookActivity = this.options.lastHookActivityAt?.();
    if (lastHookActivity && Date.now() - lastHookActivity < 60_000) {
      return [];
    }

    if (this.activeSessionId) {
      return [];
    }

    const sessionId = this.options.idFactory?.() ?? globalThis.crypto.randomUUID();
    this.activeSessionId = sessionId;
    return [this.buildObservation("session_started", sessionId)];
  }

  getSessions(): AgentSessionRecord[] {
    return [];
  }

  private buildObservation(
    activity: AgentActivityObservation["activity"],
    sessionId: string,
  ): AgentActivityObservation {
    return {
      agent: this.agent,
      activity,
      occurredAt: new Date().toISOString(),
      sessionId,
      detectionMethod: "process",
    };
  }
}
