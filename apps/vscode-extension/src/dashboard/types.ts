import type { RuntimeStatus } from "@runtimeads/sdk-contracts";

export interface DashboardViewState {
  status: RuntimeStatus;
  developerId?: string;
  logoUri?: string;
}

export type DashboardMessage =
  | { type: "state"; state: DashboardViewState }
  | { type: "openDiagnostics" };
