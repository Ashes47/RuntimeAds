import type { SignalObservabilitySnapshot } from "@runtimeads/sdk-contracts";

export class SignalObservability {
  private observationsReceived = 0;
  private signalsGenerated = 0;
  private invalidTransitions = 0;
  private unknownSessions = 0;
  private hookObservations = 0;

  recordObservation(detectionMethod?: string): void {
    this.observationsReceived += 1;
    if (detectionMethod === "hook") {
      this.hookObservations += 1;
    }
  }

  recordSignalGenerated(): void {
    this.signalsGenerated += 1;
  }

  recordInvalidTransition(): void {
    this.invalidTransitions += 1;
  }

  recordUnknownSession(): void {
    this.unknownSessions += 1;
  }

  snapshot(activeSessions: number): SignalObservabilitySnapshot {
    return {
      observationsReceived: this.observationsReceived,
      signalsGenerated: this.signalsGenerated,
      invalidTransitions: this.invalidTransitions,
      unknownSessions: this.unknownSessions,
      activeSessions,
      hookObservations: this.hookObservations,
    };
  }
}
