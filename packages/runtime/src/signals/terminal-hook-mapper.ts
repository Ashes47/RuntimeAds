import type {
  Agent,
  AgentActivityObservation,
  AgentWaitingReason,
} from "@runtimeads/sdk-contracts";
import { createHash } from "node:crypto";

export interface TerminalHookMetadata {
  hook_event_name: string;
  session_id: string;
  source?: string;
  tool_name?: string;
}

const SESSION_START_SOURCES = new Set(["startup", "resume"]);

export function mapTerminalHookToObservation(
  agent: Agent,
  metadata: TerminalHookMetadata,
  occurredAt: string,
): AgentActivityObservation | null {
  const sessionId = normalizeTerminalSessionId(agent, metadata.session_id);

  switch (metadata.hook_event_name) {
    case "SessionStart":
      if (!metadata.source || !SESSION_START_SOURCES.has(metadata.source)) {
        return null;
      }

      return {
        agent,
        activity: "session_started",
        occurredAt,
        sessionId,
        detectionMethod: "hook",
      };

    case "SessionEnd":
      return {
        agent,
        activity: "session_completed",
        occurredAt,
        sessionId,
        detectionMethod: "hook",
      };

    case "PreToolUse":
      return {
        agent,
        activity: "waiting_started",
        occurredAt,
        sessionId,
        detectionMethod: "hook",
        waitingReason: toolNameToWaitingReason(agent, metadata.tool_name),
      };

    case "PostToolUse":
    case "PostToolUseFailure":
    case "Stop":
      return {
        agent,
        activity: "waiting_ended",
        occurredAt,
        sessionId,
        detectionMethod: "hook",
      };

    case "Notification":
      if (agent !== "claude_code") {
        return null;
      }

      return {
        agent,
        activity: "waiting_started",
        occurredAt,
        sessionId,
        detectionMethod: "hook",
        waitingReason: "thinking",
      };

    case "UserPromptSubmit":
      return {
        agent,
        activity: "waiting_started",
        occurredAt,
        sessionId,
        detectionMethod: "hook",
        waitingReason: "thinking",
      };

    default:
      return null;
  }
}

export function extractTerminalHookMetadata(
  payload: Record<string, unknown>,
): TerminalHookMetadata | null {
  const hookEventName = payload.hook_event_name;
  const sessionId = payload.session_id;

  if (
    typeof hookEventName !== "string" ||
    typeof sessionId !== "string" ||
    sessionId.length === 0
  ) {
    return null;
  }

  const metadata: TerminalHookMetadata = {
    hook_event_name: hookEventName,
    session_id: sessionId,
  };

  if (typeof payload.source === "string") {
    metadata.source = payload.source;
  }

  if (typeof payload.tool_name === "string") {
    metadata.tool_name = payload.tool_name;
  }

  return metadata;
}

export function normalizeTerminalSessionId(agent: Agent, rawSessionId: string): string {
  const digest = createHash("sha256").update(`runtimeads:${agent}:${rawSessionId}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toolNameToWaitingReason(agent: Agent, toolName?: string): AgentWaitingReason {
  if (!toolName) {
    return "unknown";
  }

  if (toolName === "Bash" || toolName === "Shell") {
    return "tool_running";
  }

  if (
    toolName === "Grep" ||
    toolName === "Glob" ||
    toolName === "WebSearch" ||
    toolName === "WebFetch" ||
    toolName === "Read" ||
    toolName === "ListDir"
  ) {
    return "searching";
  }

  if (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "NotebookEdit" ||
    (agent === "codex_cli" && toolName === "apply_patch")
  ) {
    return "generating";
  }

  return "thinking";
}
