import type {
  AgentActivityObservation,
  AgentSignalEventType,
  EventEnvelope,
  Platform,
} from "@runtimeads/sdk-contracts";

export interface AttentionSignalGeneratorOptions {
  installId: string;
  platform: Platform;
  sdkVersion: string;
  idFactory?: () => string;
}

export class AttentionSignalGenerator {
  constructor(private readonly options: AttentionSignalGeneratorOptions) {}

  createEvent(
    observation: AgentActivityObservation,
    sessionId: string,
    durationMs?: number,
  ): EventEnvelope {
    const eventType = toEventType(observation.activity);
    const now = new Date().toISOString();

    return {
      eventId: this.options.idFactory?.() ?? globalThis.crypto.randomUUID(),
      eventType,
      eventVersion: 1,
      occurredAt: observation.occurredAt,
      createdAt: now,
      installId: this.options.installId,
      sessionId,
      platform: this.options.platform,
      agent: observation.agent,
      sdkVersion: this.options.sdkVersion,
      payload: buildPayload(observation, durationMs),
    };
  }
}

function toEventType(activity: AgentActivityObservation["activity"]): AgentSignalEventType {
  switch (activity) {
    case "session_started":
      return "agent.session_started";
    case "working_started":
      return "agent.working_started";
    case "waiting_started":
      return "agent.waiting_started";
    case "waiting_ended":
      return "agent.waiting_ended";
    case "session_completed":
      return "agent.session_completed";
  }
}

function buildPayload(
  observation: AgentActivityObservation,
  durationMs?: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    agent: observation.agent,
  };

  const detectionMethod = observation.detectionMethod ?? "unknown";
  const waitingReason = observation.waitingReason ?? "unknown";

  switch (observation.activity) {
    case "session_started":
    case "working_started":
      payload.detection_method = detectionMethod;
      break;
    case "waiting_started":
      payload.reason = waitingReason;
      break;
    case "session_completed":
      if (durationMs !== undefined) {
        payload.duration_ms = durationMs;
      }
      break;
    default:
      break;
  }

  if (observation.terminalId) {
    payload.terminal_id = observation.terminalId;
  }

  return payload;
}
