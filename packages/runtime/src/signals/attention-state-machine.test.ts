import { describe, expect, it } from "vitest";

import { AttentionStateMachine, InvalidAttentionTransitionError } from "./attention-state-machine";

describe("AttentionStateMachine", () => {
  it("allows the documented attention lifecycle", () => {
    const machine = new AttentionStateMachine();
    const t1 = "2026-01-01T10:00:00.000Z";
    const t2 = "2026-01-01T10:00:10.000Z";
    const t3 = "2026-01-01T10:00:20.000Z";
    const t4 = "2026-01-01T10:00:30.000Z";
    const t5 = "2026-01-01T10:00:40.000Z";

    expect(machine.transition("working", t1)).toBe(0);
    expect(machine.transition("waiting", t2)).toBe(10_000);
    expect(machine.transition("working", t3)).toBe(10_000);
    expect(machine.transition("complete", t4)).toBe(10_000);
    expect(machine.transition("idle", t5)).toBe(10_000);
    expect(machine.getState()).toBe("idle");
  });

  it("rejects invalid transitions", () => {
    const machine = new AttentionStateMachine();

    expect(() => machine.transition("waiting", "2026-01-01T10:00:00.000Z")).toThrow(
      InvalidAttentionTransitionError,
    );
  });
});
