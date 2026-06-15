import type {
  Agent,
  AgentActivityObservation,
  AgentSessionRecord,
  Platform,
} from "@runtimeads/sdk-contracts";

import { EventQueue } from "../events/event-queue";
import { InstallManager } from "../install/install-manager";
import type { RuntimeService } from "../runtime/service";
import type { KeyValueStore } from "../storage/key-value-store";
import { AgentSessionManager } from "./agent-session-manager";
import type { AgentDetector } from "./agent-detector";
import { activityToTargetState, InvalidAttentionTransitionError } from "./attention-state-machine";
import { AttentionSignalGenerator } from "./attention-signal-generator";
import { SignalObservability } from "./signal-observability";

export interface AgentDetectionServiceOptions {
  eventQueue: EventQueue;
  installManager: InstallManager;
  platform: Platform;
  sdkVersion: string;
  store?: KeyValueStore;
  detectors?: AgentDetector[];
  idFactory?: () => string;
  pollIntervalMs?: number;
  scheduler?: DetectionScheduler;
  onActivity?: (
    activity: AgentActivityObservation["activity"],
    sessionId?: string,
    context?: AgentActivityContext,
  ) => Promise<void>;
  onImpressionSkip?: (reason: string) => void;
}

export interface AgentActivityContext {
  agent?: Agent;
  waitingPeriodMs?: number;
}

export interface DetectionScheduler {
  setInterval(handler: () => void, timeoutMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: DetectionScheduler = {
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

export class AgentDetectionService implements RuntimeService {
  readonly name = "agent-detection";

  private readonly detectors = new Map<string, AgentDetector>();
  private readonly sessionManager: AgentSessionManager;
  private readonly pollIntervalMs: number;
  private readonly scheduler: DetectionScheduler;
  private intervalHandle: unknown;
  private signalGenerator: AttentionSignalGenerator | undefined;
  private readonly observability = new SignalObservability();

  constructor(private readonly options: AgentDetectionServiceOptions) {
    this.sessionManager = new AgentSessionManager(options.store);
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.scheduler = options.scheduler ?? defaultScheduler;

    for (const detector of options.detectors ?? []) {
      this.registerDetector(detector);
    }
  }

  registerDetector(detector: AgentDetector): void {
    this.detectors.set(detector.name, detector);
  }

  async start(): Promise<void> {
    const installId = await this.options.installManager.ensureInstallId();
    this.signalGenerator = new AttentionSignalGenerator({
      installId,
      platform: this.options.platform,
      sdkVersion: this.options.sdkVersion,
      ...(this.options.idFactory ? { idFactory: this.options.idFactory } : {}),
    });

    await this.sessionManager.start();
    await this.sessionManager.recoverOrphanSessions();

    for (const detector of this.detectors.values()) {
      await detector.start();
    }

    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.pollDetectors().catch(() => undefined);
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }

    for (const detector of this.detectors.values()) {
      await detector.stop();
    }

    await this.sessionManager.stop();
  }

  async ingest(observation: AgentActivityObservation): Promise<void> {
    await this.processObservation(observation);
  }

  getSessions(): AgentSessionRecord[] {
    return this.sessionManager.listSessions();
  }

  getObservability() {
    return this.observability.snapshot(this.sessionManager.listSessions().length);
  }

  private async pollDetectors(): Promise<void> {
    for (const detector of this.detectors.values()) {
      const observations = await detector.detect();
      for (const observation of observations) {
        await this.processObservation(observation);
      }
    }
  }

  private async processObservation(observation: AgentActivityObservation): Promise<void> {
    if (!this.signalGenerator) {
      return;
    }

    this.observability.recordObservation(observation.detectionMethod);

    if (observation.activity === "working_started") {
      await this.enqueueSignal(observation, observation.sessionId!);
      return;
    }

    const targetState = activityToTargetState(observation.activity);
    if (!targetState) {
      return;
    }

    const sessionId =
      observation.sessionId ??
      (observation.activity === "session_started"
        ? (this.options.idFactory?.() ?? globalThis.crypto.randomUUID())
        : undefined);

    if (!sessionId) {
      return;
    }

    try {
      if (observation.activity === "waiting_started") {
        const current = this.sessionManager.getSession(sessionId);
        if (current?.state === "waiting") {
          await this.sessionManager.recordToolWaitStart(sessionId, observation.occurredAt);
          await this.enqueueSignal({ ...observation, sessionId }, sessionId);
          await this.options.onActivity?.("waiting_started", sessionId, {
            ...(observation.agent ? { agent: observation.agent } : {}),
          });
          return;
        }
      }

      if (observation.activity === "session_started") {
        await this.sessionManager.openSession({
          sessionId,
          agent: observation.agent,
          ...(observation.terminalId ? { terminalId: observation.terminalId } : {}),
          occurredAt: observation.occurredAt,
        });

        await this.enqueueSignal({ ...observation, sessionId }, sessionId);
        await this.enqueueWorkingStarted(observation, sessionId);
        return;
      }

      let activityContext: AgentActivityContext | undefined;
      let skipTransition = false;

      if (observation.activity === "waiting_ended") {
        const current = this.sessionManager.getSession(sessionId);
        if (!current) {
          this.options.onImpressionSkip?.("hook_no_agent_session");
          return;
        }

        let waitingPeriodMs: number | undefined;
        if (current.state === "waiting") {
          waitingPeriodMs = Math.max(
            0,
            Date.parse(observation.occurredAt) - Date.parse(current.stateEnteredAt),
          );
        } else {
          const toolWaitStartedAt = this.sessionManager.getToolWaitStartedAt(sessionId);
          if (!toolWaitStartedAt) {
            this.options.onImpressionSkip?.("hook_not_waiting");
            return;
          }

          waitingPeriodMs = Math.max(
            0,
            Date.parse(observation.occurredAt) - Date.parse(toolWaitStartedAt),
          );
          skipTransition = true;
        }

        activityContext = {
          agent: observation.agent,
          waitingPeriodMs,
        };
        await this.sessionManager.clearToolWaitStart(sessionId);
      } else if (observation.activity !== "session_completed") {
        await this.ensureActiveSession(observation, sessionId);
      }

      if (skipTransition) {
        await this.enqueueSignal(
          { ...observation, sessionId },
          sessionId,
          undefined,
          activityContext,
        );
        await this.enqueueWorkingStarted(observation, sessionId);
        return;
      }

      const session = await this.sessionManager.applyTransition({
        sessionId,
        nextState: targetState,
        occurredAt: observation.occurredAt,
      });

      if (observation.activity === "waiting_started") {
        await this.sessionManager.recordToolWaitStart(sessionId, observation.occurredAt);
      }

      const durationMs =
        observation.activity === "session_completed"
          ? session.workingMs + session.waitingMs
          : undefined;

      if (observation.activity === "session_completed") {
        activityContext = { agent: observation.agent };
      }

      await this.enqueueSignal(
        { ...observation, sessionId },
        sessionId,
        durationMs,
        activityContext,
      );

      if (observation.activity === "waiting_ended") {
        await this.enqueueWorkingStarted(observation, sessionId);
      }
    } catch (error) {
      if (error instanceof InvalidAttentionTransitionError) {
        this.observability.recordInvalidTransition();
        return;
      }

      if (error instanceof Error && error.message.startsWith("Unknown active agent session:")) {
        this.observability.recordUnknownSession();
        return;
      }

      throw error;
    }
  }

  private async enqueueSignal(
    observation: AgentActivityObservation,
    sessionId: string,
    durationMs?: number,
    context?: AgentActivityContext,
  ): Promise<void> {
    await this.options.eventQueue.enqueue(
      this.signalGenerator!.createEvent({ ...observation, sessionId }, sessionId, durationMs),
    );
    this.observability.recordSignalGenerated();
    await this.options.onActivity?.(observation.activity, sessionId, context);
  }

  private async ensureActiveSession(
    observation: AgentActivityObservation,
    sessionId: string,
  ): Promise<void> {
    const existing = this.sessionManager.getSession(sessionId);
    if (existing && !existing.endedAt) {
      return;
    }

    await this.sessionManager.openSession({
      sessionId,
      agent: observation.agent,
      ...(observation.terminalId ? { terminalId: observation.terminalId } : {}),
      occurredAt: observation.occurredAt,
    });
  }

  private async enqueueWorkingStarted(
    observation: AgentActivityObservation,
    sessionId: string,
  ): Promise<void> {
    const workingObservation: AgentActivityObservation = {
      agent: observation.agent,
      activity: "working_started",
      occurredAt: observation.occurredAt,
      sessionId,
      ...(observation.terminalId ? { terminalId: observation.terminalId } : {}),
      ...(observation.detectionMethod ? { detectionMethod: observation.detectionMethod } : {}),
    };
    await this.enqueueSignal(workingObservation, sessionId);
  }
}
