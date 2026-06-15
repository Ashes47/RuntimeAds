import type {
  Agent,
  AgentActivityObservation,
  AgentSessionRecord,
} from "@runtimeads/sdk-contracts";

export interface AgentDetector {
  readonly agent: Agent;
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  detect(): Promise<AgentActivityObservation[]>;
  getSessions(): AgentSessionRecord[];
}
