import type {
  Agent,
  AgentActivityObservation,
  AgentSessionRecord,
} from "@runtimeads/sdk-contracts";
import type { AgentDetector } from "@runtimeads/runtime";
import { window } from "vscode";

interface ActiveTerminalSession {
  agent: Agent;
  sessionId: string;
}

export class VscodeTerminalDetector implements AgentDetector {
  readonly agent: Agent = "claude_code";
  readonly name = "vscode-terminal-detector";

  private running = false;
  private readonly activeTerminalSessions = new Map<string, ActiveTerminalSession>();

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.activeTerminalSessions.clear();
  }

  async detect(): Promise<AgentActivityObservation[]> {
    if (!this.running) {
      return [];
    }

    const observations: AgentActivityObservation[] = [];
    const activeTerminalNames = new Set<string>();

    for (const terminal of window.terminals) {
      const agent = this.resolveTerminalAgent(terminal.name);
      if (!agent) {
        continue;
      }

      activeTerminalNames.add(terminal.name);
      if (this.activeTerminalSessions.has(terminal.name)) {
        continue;
      }

      const sessionId = globalThis.crypto.randomUUID();
      this.activeTerminalSessions.set(terminal.name, { agent, sessionId });
      observations.push({
        agent,
        activity: "session_started",
        occurredAt: new Date().toISOString(),
        sessionId,
        terminalId: terminal.name,
        detectionMethod: "terminal",
      });
    }

    for (const [terminalName, session] of this.activeTerminalSessions.entries()) {
      if (activeTerminalNames.has(terminalName)) {
        continue;
      }

      this.activeTerminalSessions.delete(terminalName);
      observations.push({
        agent: session.agent,
        activity: "session_completed",
        occurredAt: new Date().toISOString(),
        sessionId: session.sessionId,
        terminalId: terminalName,
        detectionMethod: "terminal",
      });
    }

    return observations;
  }

  getSessions(): AgentSessionRecord[] {
    return [];
  }

  private resolveTerminalAgent(name: string): Agent | undefined {
    const normalized = name.toLowerCase();
    if (normalized.includes("claude") || normalized.includes("anthropic")) {
      return "claude_code";
    }

    if (normalized.includes("codex") || normalized.includes("openai")) {
      return "codex_cli";
    }

    return undefined;
  }
}
