import type { AttentionRuntime } from "@runtimeads/runtime";
import type { ExtensionContext } from "vscode";
import { commands, env, Uri, window } from "vscode";

import { DashboardPanel } from "../panels/dashboard-panel";
import { DiagnosticsPanel } from "../panels/diagnostics-panel";
import {
  clearSpinnerMessageFromRuntime,
  restoreSpinnerMessageFromRuntime,
} from "../signals/claude-hook-display";
import { showRuntimeAdsMenu } from "./runtimeads-menu";
import { HOOKS_CONSENT_GRANTED_KEY, HOOKS_NEVER_PROMPT_KEY } from "../signals/hook-consent-prompt";
import {
  installTerminalHooks,
  removeGlobalHooks,
  removeTerminalHooks,
} from "../signals/terminal-hook-installer";
import { listPatchedWorkspaces, removePatchedWorkspace } from "../signals/patched-workspaces";
import type { ClaudeCodeWebviewService } from "../rendering/claude-code-webview-service";
import type { CodexWebviewService } from "../rendering/codex-webview-service";
import type { ClaudeCliSyncService } from "../signals/claude-cli-sync";
import type { CodexCliSyncService } from "../signals/codex-cli-sync";
import type { ClaudeHookServerHandle } from "../signals/claude-hook-server";
import { StatusBarService } from "../status-bar/status-bar-service";
import { formatTechnicalReason } from "../user-messages";

export function registerCommands(
  context: ExtensionContext,
  runtime: AttentionRuntime,
  statusBar: StatusBarService,
  apiBaseUrl: string,
  claudeHookServer?: ClaudeHookServerHandle,
  claudeWebviewService?: ClaudeCodeWebviewService,
  codexWebviewService?: CodexWebviewService,
  claudeCliSyncService?: ClaudeCliSyncService,
  codexCliSyncService?: CodexCliSyncService,
): void {
  context.subscriptions.push(
    commands.registerCommand("runtimeads.login", async () => {
      const callbackUri = Uri.parse(`${env.uriScheme}://runtimeads.runtimeads/auth/callback`);
      const state = globalThis.crypto.randomUUID();
      const loginUrl = Uri.parse(
        `${apiBaseUrl}/v1/auth/google/start?redirect_uri=${encodeURIComponent(
          callbackUri.toString(true),
        )}&state=${encodeURIComponent(state)}`,
      );
      await env.openExternal(loginUrl);
      window.showInformationMessage("RuntimeAds sign-in opened in your browser.");
    }),
    commands.registerCommand("runtimeads.logout", async () => {
      await runtime.getAuthSessionManager().logout();
      await runtime.getTelemetryService().record("auth.logout");
      // Stop showing ads immediately and until the user signs in again. The allocation
      // resolver is auth-gated (so polled surfaces — panels, status bar — go empty on their
      // next tick), but clear the cache and the write-once CLI/spinner surfaces here so
      // nothing lingers. Hooks/patches stay in place, so ads resume on the next sign-in.
      try {
        await runtime.getCacheStore().clear();
        await clearSpinnerMessageFromRuntime(runtime);
        claudeCliSyncService?.clearCliSurfaces();
        codexCliSyncService?.clearBanner();
        await Promise.all([
          claudeWebviewService?.applyCurrentAd(),
          codexWebviewService?.applyCurrentAd(true),
        ]);
      } catch {
        // Best-effort surface cleanup; sign-out itself already succeeded.
      }
      await statusBar.refresh();
      window.showInformationMessage("Signed out of RuntimeAds.");
    }),
    commands.registerCommand("runtimeads.openDashboard", async () => {
      await DashboardPanel.show(context, runtime, async () => {
        await runtime.getTelemetryService().record("dashboard.opened");
      });
    }),
    commands.registerCommand("runtimeads.openActiveAd", async () => {
      await statusBar.openActiveAd();
    }),
    commands.registerCommand("runtimeads.openMenu", async () => {
      await showRuntimeAdsMenu(runtime);
    }),
    commands.registerCommand("runtimeads.showDiagnostics", async () => {
      await runtime.getTelemetryService().record("diagnostic.opened");
      DiagnosticsPanel.show(context.extensionUri, runtime);
    }),
    commands.registerCommand("runtimeads.installTerminalHooks", async () => {
      if (!claudeHookServer) {
        window.showErrorMessage("RuntimeAds is still starting — try again in a moment.");
        return;
      }

      try {
        await installTerminalHooks(
          context,
          runtime,
          claudeHookServer,
          claudeWebviewService,
          codexWebviewService,
          claudeCliSyncService,
        );
        await context.globalState.update(HOOKS_CONSENT_GRANTED_KEY, true);
        // Manually setting up re-enables auto-setup if the user had previously opted out via Remove.
        await context.globalState.update(HOOKS_NEVER_PROMPT_KEY, undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown hook install error";
        window.showErrorMessage(`Could not set up Claude & Codex: ${message}`);
      }
    }),
    commands.registerCommand("runtimeads.restoreWebviewPatches", async () => {
      const results = await Promise.all([
        claudeWebviewService?.restore(),
        codexWebviewService?.restore(),
        Promise.resolve(claudeCliSyncService?.restore()),
        Promise.resolve(codexCliSyncService?.restore()),
      ]);
      const failures = results.filter((result) => result && !result.ok);
      if (failures.length > 0) {
        window.showErrorMessage(
          `Could not restore original panels: ${failures.map((r) => formatTechnicalReason(r?.reason ?? "unknown")).join("; ")}`,
        );
        return;
      }

      window.showInformationMessage(
        "RuntimeAds removed its changes from Claude and Codex panels. Reload those panels to finish.",
      );
    }),
    commands.registerCommand("runtimeads.dismissAd", async () => {
      await clearSpinnerMessageFromRuntime(runtime);
      await Promise.all([
        claudeWebviewService?.refreshPatchedBlock(),
        codexWebviewService?.refreshPatchedBlock(),
      ]);
      await statusBar.refresh();
      window.showInformationMessage(
        "RuntimeAds sponsor hidden. Use Restore Sponsor Ads from the menu to bring them back.",
      );
    }),
    commands.registerCommand("runtimeads.restoreAds", async () => {
      await restoreSpinnerMessageFromRuntime(runtime);
      await Promise.all([
        claudeWebviewService?.applyCurrentAd(true),
        codexWebviewService?.applyCurrentAd(true),
      ]);
      await statusBar.refresh();
      window.showInformationMessage(
        "Sponsor ads restored. Reload Claude and Codex panels; restart terminal Claude if you use the CLI.",
      );
    }),
    commands.registerCommand("runtimeads.removeIntegrations", async () => {
      const warnings: string[] = [];

      const restoreResults = await Promise.all([
        claudeWebviewService?.restore(),
        codexWebviewService?.restore(),
        Promise.resolve(claudeCliSyncService?.restore()),
        Promise.resolve(codexCliSyncService?.restore()),
      ]);
      for (const result of restoreResults) {
        if (result && !result.ok) {
          warnings.push(result.reason ?? "unknown restore failure");
        }
      }

      let removedFileCount = 0;
      try {
        const removal = await removeGlobalHooks();
        removedFileCount += removal.removedFiles.length;
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "global hook removal failed");
      }
      // Clean up any leftover per-workspace installs from older (pre-global) builds.
      for (const workspaceRoot of listPatchedWorkspaces()) {
        try {
          const removal = await removeTerminalHooks(workspaceRoot);
          removedFileCount += removal.removedFiles.length;
          removePatchedWorkspace(workspaceRoot);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "legacy hook removal failed");
        }
      }

      try {
        await runtime.getCacheStore().clear();
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "cache wipe failed");
      }

      // Sign out and forget the local install identity. Credentials live in the editor's
      // SecretStorage (OS keychain), which a plain extension uninstall does NOT reliably
      // clear — so we wipe them here, while we still have API access, to leave a clean slate
      // on reinstall.
      try {
        await runtime.getAuthSessionManager().logout();
        await runtime.getInstallManager().clearStoredInstall();
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "sign-out/local-data wipe failed");
      }

      // Setup is now automatic on activation, so an explicit removal must NOT silently re-install on
      // the next reload. Clear the consent flag and OPT OUT (never-prompt) so auto-setup stays off
      // until the user runs "Set Up Claude & Codex" again (which clears the opt-out), or does a clean
      // reinstall (which clears globalState entirely).
      await context.globalState.update(HOOKS_CONSENT_GRANTED_KEY, undefined);
      await context.globalState.update(HOOKS_NEVER_PROMPT_KEY, true);
      await statusBar.refresh();

      if (warnings.length > 0) {
        window.showWarningMessage(
          `RuntimeAds was removed with warnings: ${warnings.map(formatTechnicalReason).join("; ")}. Reload the window to finish.`,
        );
        return;
      }

      window.showInformationMessage(
        `RuntimeAds was removed and signed out${
          removedFileCount > 0 ? ` (${removedFileCount} file(s) cleaned up)` : ""
        }. Reload the window to finish.`,
      );
    }),
  );
}
