import type { ExtensionContext } from "vscode";
import { commands, env, Uri, window, workspace } from "vscode";

import {
  ClaudeAdapter,
  CodexAdapter,
  createRuntime,
  ProcessClaudeDetector,
} from "@runtimeads/runtime";

import { AuthCallbackHandler } from "./auth/auth-callback-handler";
import { registerCommands } from "./commands/register-commands";
import { createLocalStore } from "./storage/create-local-store";
import { startClaudeHookServer, type ClaudeHookServerHandle } from "./signals/claude-hook-server";
import { ClaudeCodeWebviewService } from "./rendering/claude-code-webview-service";
import { CodexWebviewService } from "./rendering/codex-webview-service";
import {
  registerClaudeCliSync,
  registerCodexCliSync,
  registerDisplayWebviews,
  registerStatusBar,
  syncSpinnerMessageFromRuntime,
} from "./signals/claude-hook-display";
import { ClaudeCliSyncService } from "./signals/claude-cli-sync";
import { CodexCliSyncService } from "./signals/codex-cli-sync";
import { promptForHookConsent } from "./signals/hook-consent-prompt";
import { refreshTerminalHooksIfNeeded } from "./signals/terminal-hook-installer";
import { registerTerminalAdLinkProvider } from "./signals/terminal-ad-link-provider";
import { getCachedHookIntegrity, refreshHookIntegrityState } from "./signals/hook-integrity";
import { StatusBarService } from "./status-bar/status-bar-service";
import { VscodeTerminalDetector } from "./signals/vscode-terminal-detector";
import { formatPreflightIssue } from "./user-messages";

let runtime: ReturnType<typeof createRuntime> | undefined;
let statusBar: StatusBarService | undefined;
let disposeLocalStore: (() => Promise<void>) | undefined;
let claudeHookServer: ClaudeHookServerHandle | undefined;
let claudeWebviewService: ClaudeCodeWebviewService | undefined;
let codexWebviewService: CodexWebviewService | undefined;
let claudeCliSyncService: ClaudeCliSyncService | undefined;
let codexCliSyncService: CodexCliSyncService | undefined;

// P1-25: the server rejected this build as outdated (HTTP 426). Ads/sync stay paused;
// prompt the user to update via the Marketplace.
async function promptExtensionUpdate(extensionId: string): Promise<void> {
  const choice = await window.showWarningMessage(
    "RuntimeAds is out of date and has paused until you update. Update to the latest version to resume earning.",
    "Update",
  );
  if (choice === "Update") {
    await env.openExternal(
      Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${extensionId}`),
    );
  }
}

// The refresh token was rejected (session permanently over). The runtime has already cleared
// credentials and stopped retrying; just prompt the user to sign in again.
async function promptSignInAgain(): Promise<void> {
  const choice = await window.showWarningMessage(
    "Your RuntimeAds session expired. Sign in again to keep earning.",
    "Sign In",
  );
  if (choice === "Sign In") {
    await commands.executeCommand("runtimeads.login");
  }
}

export async function activate(context: ExtensionContext) {
  const config = workspace.getConfiguration("runtimeads");
  const apiBaseUrl = config.get<string>("apiBaseUrl", "https://api.runtimeads.com");

  const localStore = await createLocalStore(context);
  disposeLocalStore = localStore.dispose;

  const extensionManifest = context.extension.packageJSON as {
    version?: string;
    publisher?: string;
  };

  // P1-22: Cursor is a VS Code fork; distinguish it so analytics/fraud see the real host.
  const isCursor =
    env.appName?.toLowerCase().includes("cursor") || env.uriScheme?.toLowerCase() === "cursor";

  // P1-20: the host's IANA timezone (e.g. "America/New_York") for coarse install geo. No
  // precise location is collected. Guarded since Intl can throw in unusual runtimes.
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timezone = undefined;
  }

  runtime = createRuntime({
    platform: isCursor ? "cursor" : "vscode",
    secureStore: context.secrets,
    localStore: localStore.store,
    sqliteDatabase: localStore.sqliteDatabase,
    apiBaseUrl,
    os: process.platform,
    ...(timezone ? { timezone } : {}),
    // P1-25 extension version gate metadata from the host manifest.
    extensionId: context.extension.id,
    ...(extensionManifest.version ? { extensionVersion: extensionManifest.version } : {}),
    ...(extensionManifest.publisher ? { publisher: extensionManifest.publisher } : {}),
    onVersionRejected: () => void promptExtensionUpdate(context.extension.id),
    onSessionExpired: () => void promptSignInAgain(),
    agentDetectors: [
      new ClaudeAdapter(),
      new CodexAdapter(),
      new ProcessClaudeDetector(),
      new VscodeTerminalDetector(),
    ],
    hookIntegrityProvider: () => {
      const payload = getCachedHookIntegrity();
      if (!payload) {
        return undefined;
      }
      return {
        ok: payload.ok,
        mismatchedFiles: payload.mismatchedFiles,
        fileHashes: payload.fileHashes,
        ...(payload.manifestMtime ? { manifestMtime: payload.manifestMtime } : {}),
      };
    },
  });

  claudeHookServer = await startClaudeHookServer(runtime);
  claudeWebviewService = new ClaudeCodeWebviewService(context, runtime, claudeHookServer);
  codexWebviewService = new CodexWebviewService(context, runtime, claudeHookServer);
  const workspaceClaudeSettings = workspace.workspaceFolders?.[0]
    ? `${workspace.workspaceFolders[0].uri.fsPath}/.claude/settings.json`
    : undefined;
  claudeCliSyncService = new ClaudeCliSyncService(context.extensionPath, workspaceClaudeSettings);
  claudeCliSyncService.setWebviewBaseUrl(claudeHookServer.webviewBaseUrl);
  codexCliSyncService = new CodexCliSyncService(context.extensionPath);
  registerClaudeCliSync(claudeCliSyncService);
  registerCodexCliSync(codexCliSyncService);
  registerDisplayWebviews(claudeWebviewService, codexWebviewService);
  statusBar = new StatusBarService(
    runtime,
    claudeWebviewService,
    codexWebviewService,
    claudeCliSyncService,
  );
  registerStatusBar(statusBar);

  context.subscriptions.push(
    window.registerUriHandler(new AuthCallbackHandler(runtime, statusBar)),
  );
  await runtime.start();
  await reportPatchPreflight(claudeWebviewService, codexWebviewService, codexCliSyncService);
  await Promise.all([claudeWebviewService.primeCsp(), codexWebviewService.primeCsp()]);
  await Promise.all([
    claudeWebviewService.applyCurrentAd(),
    codexWebviewService.applyCurrentAd(true),
  ]);
  await syncSpinnerMessageFromRuntime(runtime);
  registerCommands(
    context,
    runtime,
    statusBar,
    apiBaseUrl,
    claudeHookServer,
    claudeWebviewService,
    codexWebviewService,
    claudeCliSyncService,
    codexCliSyncService,
  );
  registerTerminalAdLinkProvider(context, runtime);
  context.subscriptions.push({
    dispose: () => {
      statusBar?.stop();
    },
  });

  statusBar.start(context);
  await statusBar.refresh();

  const codexReassertTimer = setInterval(() => {
    void codexWebviewService?.applyCurrentAd(true);
  }, 60_000);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(codexReassertTimer);
    },
  });
  setTimeout(() => {
    void codexWebviewService?.applyCurrentAd(true);
  }, 10_000);

  void (async () => {
    // Hooks are installed user-globally (~/.claude, ~/.codex) so none of this needs an open folder.
    await refreshHookIntegrityState({ extensionPath: context.extensionPath });

    const refreshedHooks = await refreshTerminalHooksIfNeeded(context, claudeHookServer);
    if (refreshedHooks) {
      await refreshHookIntegrityState({ extensionPath: context.extensionPath });
      void window.showInformationMessage(
        "RuntimeAds updated its Claude & Codex setup. Restart any running claude or codex session to pick it up.",
      );
    }

    await promptForHookConsent(
      context,
      runtime,
      claudeHookServer,
      claudeWebviewService,
      codexWebviewService,
      claudeCliSyncService,
    );
  })();
}

async function reportPatchPreflight(
  claudeWebview?: ClaudeCodeWebviewService,
  codexWebview?: CodexWebviewService,
  codexCli?: CodexCliSyncService,
): Promise<void> {
  const issues: Array<[string, string]> = [];
  const claude = claudeWebview?.preflight();
  if (claude && !claude.ok && claude.reason) {
    issues.push(["claude_overlay", claude.reason]);
  }

  const codex = codexWebview?.preflight();
  if (codex && !codex.ok && codex.reason) {
    issues.push(["codex_overlay", codex.reason]);
  }

  const codexCliResult = codexCli?.preflight();
  if (codexCliResult && !codexCliResult.ok && codexCliResult.reason) {
    issues.push(["codex_cli_banner", codexCliResult.reason]);
  }

  if (issues.length > 0) {
    void window.showWarningMessage(
      `Sponsor ads unavailable in some places: ${issues.map(([surface, reason]) => formatPreflightIssue(surface, reason)).join("; ")}`,
    );
  }
}

export async function deactivate() {
  statusBar?.stop();
  await claudeHookServer?.dispose();
  claudeHookServer = undefined;
  claudeWebviewService = undefined;
  codexWebviewService = undefined;
  claudeCliSyncService = undefined;
  await runtime?.stop();
  await disposeLocalStore?.();
  disposeLocalStore = undefined;
}
