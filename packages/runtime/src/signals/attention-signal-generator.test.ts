import { describe, expect, it } from "vitest";

import { AttentionSignalGenerator } from "./attention-signal-generator";

describe("AttentionSignalGenerator", () => {
  it("creates versioned agent signal envelopes", () => {
    const generator = new AttentionSignalGenerator({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      idFactory: () => "event-1",
    });

    const event = generator.createEvent(
      {
        agent: "claude_code",
        activity: "waiting_started",
        occurredAt: "2026-01-01T10:00:00.000Z",
        sessionId: "session-1",
        waitingReason: "thinking",
      },
      "session-1",
    );

    expect(event).toMatchObject({
      eventId: "event-1",
      eventType: "agent.waiting_started",
      eventVersion: 1,
      installId: "install-1",
      sessionId: "session-1",
      agent: "claude_code",
      payload: {
        agent: "claude_code",
        reason: "thinking",
      },
    });
  });
});
