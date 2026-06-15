import { describe, expect, it } from "vitest";

import { ProcessClaudeDetector } from "./process-claude-detector";

describe("ProcessClaudeDetector", () => {
  it("emits session_started when the process is running and hooks are stale", async () => {
    const detector = new ProcessClaudeDetector({
      isProcessRunning: () => true,
      lastHookActivityAt: () => Date.now() - 120_000,
      idFactory: () => "session-process-1",
    });

    await detector.start();
    const observations = await detector.detect();

    expect(observations).toEqual([
      expect.objectContaining({
        activity: "session_started",
        sessionId: "session-process-1",
        detectionMethod: "process",
      }),
    ]);
  });

  it("defers to hooks when hook activity is recent", async () => {
    const detector = new ProcessClaudeDetector({
      isProcessRunning: () => true,
      lastHookActivityAt: () => Date.now(),
    });

    await detector.start();
    const observations = await detector.detect();

    expect(observations).toEqual([]);
  });

  it("emits session_completed when the process stops", async () => {
    let running = true;
    const detector = new ProcessClaudeDetector({
      isProcessRunning: () => running,
      lastHookActivityAt: () => Date.now() - 120_000,
      idFactory: () => "session-process-2",
    });

    await detector.start();
    await detector.detect();
    running = false;

    const observations = await detector.detect();

    expect(observations).toEqual([
      expect.objectContaining({
        activity: "session_completed",
        sessionId: "session-process-2",
        detectionMethod: "process",
      }),
    ]);
  });
});
