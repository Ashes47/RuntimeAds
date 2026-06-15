import type { RuntimeStatus } from "@runtimeads/sdk-contracts";

export interface DiagnosticsErrorRecord {
  message: string;
  source: string;
  occurredAt: string;
}

export interface DiagnosticsSnapshot {
  status: RuntimeStatus;
  generatedAt: string;
  recentErrors: DiagnosticsErrorRecord[];
  privacyBoundary: {
    prompts: "not_collected";
    responses: "not_collected";
    code: "not_collected";
    terminalOutput: "not_collected";
    filePaths: "not_collected";
    repositoryNames: "not_collected";
  };
}

export class DiagnosticsService {
  private readonly recentErrors: DiagnosticsErrorRecord[] = [];
  private readonly maxErrors: number;

  constructor(options?: { maxErrors?: number }) {
    this.maxErrors = options?.maxErrors ?? 20;
  }

  recordError(message: string, source: string): void {
    const latest = this.recentErrors[0];
    if (latest?.message === message && latest.source === source) {
      latest.occurredAt = new Date().toISOString();
      return;
    }

    this.recentErrors.unshift({
      message,
      source,
      occurredAt: new Date().toISOString(),
    });

    if (this.recentErrors.length > this.maxErrors) {
      this.recentErrors.length = this.maxErrors;
    }
  }

  createSnapshot(status: RuntimeStatus): DiagnosticsSnapshot {
    return {
      status,
      generatedAt: new Date().toISOString(),
      recentErrors: [...this.recentErrors],
      privacyBoundary: {
        prompts: "not_collected",
        responses: "not_collected",
        code: "not_collected",
        terminalOutput: "not_collected",
        filePaths: "not_collected",
        repositoryNames: "not_collected",
      },
    };
  }
}
