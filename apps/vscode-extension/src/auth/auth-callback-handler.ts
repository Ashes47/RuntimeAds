import type { AttentionRuntime } from "@runtimeads/runtime";
import type { Uri, UriHandler } from "vscode";

import { syncSpinnerMessageFromRuntime } from "../signals/claude-hook-display";
import { StatusBarService } from "../status-bar/status-bar-service";

export class AuthCallbackHandler implements UriHandler {
  constructor(
    private readonly runtime: AttentionRuntime,
    private readonly statusBar: StatusBarService,
  ) {}

  async handleUri(uri: Uri): Promise<void> {
    if (uri.path !== "/auth/callback") {
      return;
    }

    const params = new URLSearchParams(uri.query);
    const code = params.get("code");

    if (!code) {
      throw new Error("RuntimeAds auth callback is missing the authorization code");
    }

    // Trade the one-time code for tokens server-to-server; tokens never ride in the URL.
    const { developerId } = await this.runtime.getAuthSessionManager().redeemSession(code);
    // Force re-register on a fresh sign-in (the per-session guard may otherwise skip it).
    await this.runtime.ensureInstallRegistered(true);
    await this.runtime.refillInventoryIfNeeded();
    await syncSpinnerMessageFromRuntime(this.runtime);
    await this.runtime.getHeartbeatService().send();
    await this.runtime.getSyncEngine().flush();
    await this.runtime.getTelemetryService().record("auth.login", { developerId });
    await this.statusBar.refresh();
  }
}
