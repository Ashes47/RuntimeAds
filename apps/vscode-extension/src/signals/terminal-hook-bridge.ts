import type { AgentActivityObservation } from "@runtimeads/sdk-contracts";
import type { AttentionRuntime } from "@runtimeads/runtime";

export async function reportTerminalActivity(
  runtime: AttentionRuntime,
  observation: AgentActivityObservation,
): Promise<void> {
  // Apply hook observations immediately so display sync can see waiting sessions.
  // Queueing on the terminal adapter deferred ingest until the next poll tick.
  await runtime.getAgentDetectionService().ingest(observation);
}
