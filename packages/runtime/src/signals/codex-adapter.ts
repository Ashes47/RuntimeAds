import type {
  Agent,
  AgentActivityObservation,
  AgentSessionRecord,
} from "@runtimeads/sdk-contracts";

import type { AgentDetector } from "./agent-detector";

export class CodexAdapter implements AgentDetector {
  readonly agent: Agent = "codex_cli";
  readonly name = "codex-adapter";

  private readonly pending: AgentActivityObservation[] = [];
  private running = false;

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pending.length = 0;
  }

  report(observation: AgentActivityObservation): void {
    if (!this.running || observation.agent !== this.agent) {
      return;
    }

    this.pending.push(observation);
  }

  async detect(): Promise<AgentActivityObservation[]> {
    if (this.pending.length === 0) {
      return [];
    }

    return this.pending.splice(0, this.pending.length);
  }

  getSessions(): AgentSessionRecord[] {
    return [];
  }
}
