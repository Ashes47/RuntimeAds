import { describe, expect, it } from "vitest";

import { EventQueue } from "../events/event-queue";
import { InstallManager } from "../install/install-manager";
import { MemoryKeyValueStore } from "../storage/key-value-store";
import { AgentDetectionService } from "./agent-detection-service";
import { ClaudeAdapter } from "./claude-adapter";

describe("AgentDetectionService", () => {
  it("queues attention signal events from Claude adapter observations", async () => {
    const store = new MemoryKeyValueStore();
    const queue = new EventQueue(store);
    const claude = new ClaudeAdapter();
    const service = new AgentDetectionService({
      eventQueue: queue,
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      detectors: [claude],
      idFactory: () => "session-1",
      pollIntervalMs: 60_000,
    });

    await service.start();

    claude.report({
      agent: "claude_code",
      activity: "session_started",
      occurredAt: "2026-01-01T10:00:00.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
    });
    claude.report({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:10.000Z",
      sessionId: "session-1",
      waitingReason: "thinking",
    });
    claude.report({
      agent: "claude_code",
      activity: "waiting_ended",
      occurredAt: "2026-01-01T10:00:20.000Z",
      sessionId: "session-1",
    });
    claude.report({
      agent: "claude_code",
      activity: "session_completed",
      occurredAt: "2026-01-01T10:00:30.000Z",
      sessionId: "session-1",
    });

    await (service as unknown as { pollDetectors(): Promise<void> }).pollDetectors();

    const events = await queue.listUploadable(10);
    const eventTypes = events.map((record) => record.event.eventType);

    expect(eventTypes).toEqual([
      "agent.session_started",
      "agent.working_started",
      "agent.waiting_started",
      "agent.waiting_ended",
      "agent.working_started",
      "agent.session_completed",
    ]);
    expect(events[0]?.event.sessionId).toBe("session-1");
    expect(events[0]?.event.payload).toMatchObject({
      agent: "claude_code",
      detection_method: "hook",
    });
    expect(service.getSessions()).toHaveLength(0);
    expect(service.getObservability()).toMatchObject({
      observationsReceived: 4,
      signalsGenerated: 6,
      hookObservations: 1,
      activeSessions: 0,
    });

    await service.stop();
  });

  it("opens a session lazily for tool waits when SessionStart was skipped", async () => {
    const store = new MemoryKeyValueStore();
    const queue = new EventQueue(store);
    const service = new AgentDetectionService({
      eventQueue: queue,
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      detectors: [],
      idFactory: () => "session-1",
    });

    await service.start();
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:10.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
      waitingReason: "tool_running",
    });

    expect(service.getSessions()).toHaveLength(1);
    expect(service.getSessions()[0]?.state).toBe("waiting");
    expect(service.getObservability().unknownSessions).toBe(0);
    await service.stop();
  });

  it("tracks tool waits when PreToolUse fires during an existing wait", async () => {
    const store = new MemoryKeyValueStore();
    const queue = new EventQueue(store);
    const waitingEnded: Array<{ waitingPeriodMs?: number }> = [];
    const service = new AgentDetectionService({
      eventQueue: queue,
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      detectors: [],
      idFactory: () => "session-1",
      onActivity: async (activity, _sessionId, context) => {
        if (activity === "waiting_ended" && context) {
          waitingEnded.push(context);
        }
      },
    });

    await service.start();
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:00.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
      waitingReason: "thinking",
    });
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:02.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
      waitingReason: "tool_running",
    });
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_ended",
      occurredAt: "2026-01-01T10:00:10.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
    });

    expect(service.getSessions()[0]?.state).toBe("working");
    expect(waitingEnded[0]?.waitingPeriodMs).toBe(10_000);
    expect(service.getObservability().invalidTransitions).toBe(0);
    await service.stop();
  });

  it("records tool wait duration when PostToolUse arrives after thinking ended", async () => {
    const store = new MemoryKeyValueStore();
    const queue = new EventQueue(store);
    const waitingEnded: Array<{ waitingPeriodMs?: number }> = [];
    const service = new AgentDetectionService({
      eventQueue: queue,
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      detectors: [],
      idFactory: () => "session-1",
      onActivity: async (activity, _sessionId, context) => {
        if (activity === "waiting_ended" && context) {
          waitingEnded.push(context);
        }
      },
    });

    await service.start();
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:00.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
      waitingReason: "thinking",
    });
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_ended",
      occurredAt: "2026-01-01T10:00:01.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
    });
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:01.500Z",
      sessionId: "session-1",
      detectionMethod: "hook",
      waitingReason: "tool_running",
    });
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_ended",
      occurredAt: "2026-01-01T10:00:09.500Z",
      sessionId: "session-1",
      detectionMethod: "hook",
    });

    expect(waitingEnded[1]?.waitingPeriodMs).toBe(8_000);
    await service.stop();
  });

  it("ignores waiting_ended when the session is not waiting", async () => {
    const store = new MemoryKeyValueStore();
    const queue = new EventQueue(store);
    const service = new AgentDetectionService({
      eventQueue: queue,
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      detectors: [],
      idFactory: () => "session-1",
    });

    await service.start();
    await service.ingest({
      agent: "claude_code",
      activity: "session_started",
      occurredAt: "2026-01-01T10:00:00.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
    });
    await service.ingest({
      agent: "claude_code",
      activity: "waiting_ended",
      occurredAt: "2026-01-01T10:00:15.000Z",
      sessionId: "session-1",
      detectionMethod: "hook",
    });

    expect(service.getSessions()[0]?.state).toBe("working");
    expect(service.getObservability().invalidTransitions).toBe(0);
    await service.stop();
  });

  it("ignores session_completed for unknown sessions", async () => {
    const store = new MemoryKeyValueStore();
    const queue = new EventQueue(store);
    const service = new AgentDetectionService({
      eventQueue: queue,
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      platform: "vscode",
      sdkVersion: "0.1.0",
      store,
      detectors: [],
      idFactory: () => "session-1",
    });

    await service.start();
    await service.ingest({
      agent: "claude_code",
      activity: "session_completed",
      occurredAt: "2026-01-01T10:00:00.000Z",
      sessionId: "missing-session",
    });

    expect(await queue.listUploadable(10)).toHaveLength(0);
    expect(service.getObservability().unknownSessions).toBe(1);
    await service.stop();
  });
});
