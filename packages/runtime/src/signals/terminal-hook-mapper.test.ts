import { describe, expect, it } from "vitest";

import {
  extractTerminalHookMetadata,
  mapTerminalHookToObservation,
  normalizeTerminalSessionId,
} from "./terminal-hook-mapper";

describe("terminal-hook-mapper", () => {
  it("maps Claude notification waits to thinking", () => {
    const waiting = mapTerminalHookToObservation(
      "claude_code",
      {
        hook_event_name: "Notification",
        session_id: "abc123",
      },
      "2026-01-01T10:00:00.000Z",
    );

    expect(waiting).toMatchObject({
      agent: "claude_code",
      activity: "waiting_started",
      waitingReason: "thinking",
    });
  });

  it("maps prompt submission to thinking waits for terminal agents", () => {
    for (const agent of ["claude_code", "codex_cli"] as const) {
      const waiting = mapTerminalHookToObservation(
        agent,
        {
          hook_event_name: "UserPromptSubmit",
          session_id: "abc123",
        },
        "2026-01-01T10:00:00.000Z",
      );

      expect(waiting).toMatchObject({
        agent,
        activity: "waiting_started",
        waitingReason: "thinking",
      });
    }
  });

  it("ignores Claude-only events for Codex", () => {
    expect(
      mapTerminalHookToObservation(
        "codex_cli",
        {
          hook_event_name: "Notification",
          session_id: "abc123",
        },
        "2026-01-01T10:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("maps Codex apply_patch waits to generating", () => {
    const waiting = mapTerminalHookToObservation(
      "codex_cli",
      {
        hook_event_name: "PreToolUse",
        session_id: "abc123",
        tool_name: "apply_patch",
      },
      "2026-01-01T10:00:10.000Z",
    );

    expect(waiting).toMatchObject({
      activity: "waiting_started",
      waitingReason: "generating",
    });
  });

  it("extracts only privacy-safe metadata fields", () => {
    const metadata = extractTerminalHookMetadata({
      hook_event_name: "PreToolUse",
      session_id: "abc123",
      tool_name: "Bash",
      cwd: "/secret/project",
      tool_input: { command: "cat secrets.env" },
      prompt: "should never be used",
    });

    expect(metadata).toEqual({
      hook_event_name: "PreToolUse",
      session_id: "abc123",
      tool_name: "Bash",
    });
  });

  it("normalizes terminal session ids per agent", () => {
    const claude = normalizeTerminalSessionId("claude_code", "abc123");
    const codex = normalizeTerminalSessionId("codex_cli", "abc123");

    expect(claude).toMatch(/^[0-9a-f-]{36}$/);
    expect(codex).toMatch(/^[0-9a-f-]{36}$/);
    expect(claude).not.toBe(codex);
  });
});
