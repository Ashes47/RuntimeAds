import { describe, expect, it } from "vitest";

import { SignalObservability } from "./signal-observability";

describe("SignalObservability", () => {
  it("tracks local detection health counters", () => {
    const observability = new SignalObservability();

    observability.recordObservation("hook");
    observability.recordSignalGenerated();
    observability.recordInvalidTransition();
    observability.recordUnknownSession();

    expect(observability.snapshot(2)).toEqual({
      observationsReceived: 1,
      signalsGenerated: 1,
      invalidTransitions: 1,
      unknownSessions: 1,
      activeSessions: 2,
      hookObservations: 1,
    });
  });
});
