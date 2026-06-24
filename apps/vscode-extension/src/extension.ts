import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
import { autoSetupHooks, nagHookSetupIfNeeded } from "./signals/hook-consent-prompt";
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

// P1-25: prompt the user to update via the Marketplace. Shared by two triggers — the
// reactive HTTP 426 rejection (build too old to register; ads/sync paused) and the
// proactive 1-min version-check poll (a newer build shipped). `message` carries the
// trigger-appropriate wording; the Update button is identical.
const PAUSED_UPDATE_MESSAGE =
  "RuntimeAds is out of date and has paused until you update. Update to the latest version to resume earning.";

// The 426 rejection and the version-check poll can both fire for an outdated build around
// startup; suppress a second popup while one is already on screen.
let updatePromptActive = false;

async function promptExtensionUpdate(extensionId: string, message?: string): Promise<void> {
  if (updatePromptActive) {
    return;
  }
  updatePromptActive = true;
  try {
    const choice = await window.showWarningMessage(message ?? PAUSED_UPDATE_MESSAGE, "Update");
    if (choice === "Update") {
      await env.openExternal(
        Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${extensionId}`),
      );
    }
  } finally {
    updatePromptActive = false;
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

// The account was banned. The runtime has already signed out, stopped, and cleared cached ads;
// point the user to the dashboard where they can read the reason and appeal.
async function notifyAccountBanned(dashboardUrl: string): Promise<void> {
  const choice = await window.showErrorMessage(
    "Your RuntimeAds account has been suspended. The extension has signed out and stopped serving ads. " +
      "Open your dashboard to see the reason and appeal.",
    "Open dashboard",
  );
  if (choice === "Open dashboard") {
    await env.openExternal(Uri.parse(dashboardUrl));
  }
}

// Best-effort web dashboard URL derived from the API base (api.runtimeads.com → runtimeads.com).
function dashboardUrlFromApi(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace("://api.", "://")}/developer`;
}

// P1-22 / Antigravity: Cursor and Antigravity are VS Code forks that rebrand both appName and
// uriScheme. Map the host to our platform tag so analytics/fraud attribute installs to the real
// editor; default to plain "vscode".
function resolveHostPlatform(): "vscode" | "cursor" | "antigravity" {
  const appName = env.appName?.toLowerCase() ?? "";
  const uriScheme = env.uriScheme?.toLowerCase() ?? "";
  if (appName.includes("antigravity") || uriScheme === "antigravity") {
    return "antigravity";
  }
  if (appName.includes("cursor") || uriScheme === "cursor") {
    return "cursor";
  }
  return "vscode";
}

export async function activate(context: ExtensionContext) {
  const config = workspace.getConfiguration("runtimeads");
  const apiBaseUrl = config.get<string>("apiBaseUrl", "https://api.runtimeads.com");

  // #9: sample the RuntimeAds home dir BEFORE anything (re)creates it. The `vscode:uninstall` hook
  // deletes ~/.runtimeads but cannot reach SecretStorage, so its absence here (with creds still in
  // the keychain) is our signal that this is a reinstall-after-uninstall — see the cleanup below.
  // `createLocalStore` writes to the editor's globalStorage, not ~/.runtimeads, so this stays valid.
  const runtimeadsHomePresentAtStartup = existsSync(join(homedir(), ".runtimeads"));

  const localStore = await createLocalStore(context);
  disposeLocalStore = localStore.dispose;

  const extensionManifest = context.extension.packageJSON as {
    version?: string;
    publisher?: string;
  };

  // P1-22: Cursor and Antigravity are VS Code forks; distinguish them so analytics/fraud see
  // the real host. Each fork rebrands both appName and uriScheme, so match on either.
  const hostPlatform = resolveHostPlatform();

  // P1-20: the host's IANA timezone (e.g. "America/New_York") for coarse install geo. No
  // precise location is collected. Guarded since Intl can throw in unusual runtimes.
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timezone = undefined;
  }

  runtime = createRuntime({
    platform: hostPlatform,
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
    onUpdateAvailable: (info) =>
      void promptExtensionUpdate(
        context.extension.id,
        info.required
          ? PAUSED_UPDATE_MESSAGE
          : `RuntimeAds ${info.latestVersion} is available. Update to get the latest improvements.`,
      ),
    onSessionExpired: () => void promptSignInAgain(),
    onAccountBanned: () => void notifyAccountBanned(dashboardUrlFromApi(apiBaseUrl)),
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

  // #9: reinstall-after-uninstall backstop. If the home dir was absent at startup (a fresh OR a
  // just-uninstalled install) AND credentials still survive in SecretStorage, this is a reinstall —
  // the uninstall hook wiped ~/.runtimeads but couldn't clear the keychain. Drop the stale identity
  // BEFORE start() so we don't resurrect a dead session/install. A truly fresh install has no creds,
  // so this is a no-op there. Best-effort: a failure just means the user may need to sign in again.
  if (
    !runtimeadsHomePresentAtStartup &&
    (await runtime.getAuthSessionManager().hasStoredCredentials())
  ) {
    try {
      await runtime.getAuthSessionManager().logout();
      await runtime.getInstallManager().clearStoredInstall();
    } catch {
      // Ignore — clean-slate is best-effort.
    }
  }

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

    await autoSetupHooks(
      context,
      runtime,
      claudeHookServer,
      claudeWebviewService,
      codexWebviewService,
      claudeCliSyncService,
    );
  })();

  // The modal above fires once at startup; this hourly toast re-nags long-open sessions whose
  // hooks still aren't set up (so they actually earn). Self-suppresses once set up / dismissed.
  const hookNagTimer = setInterval(
    () => {
      void nagHookSetupIfNeeded(
        context,
        runtime!,
        claudeHookServer!,
        claudeWebviewService,
        codexWebviewService,
        claudeCliSyncService,
      );
    },
    60 * 60 * 1000,
  );
  context.subscriptions.push({
    dispose: () => {
      clearInterval(hookNagTimer);
    },
  });
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
  statusBar = undefined;
  await claudeHookServer?.dispose();
  claudeHookServer = undefined;
  claudeWebviewService = undefined;
  codexWebviewService = undefined;
  claudeCliSyncService = undefined;
  codexCliSyncService = undefined;
  await runtime?.stop();
  runtime = undefined;
  await disposeLocalStore?.();
  disposeLocalStore = undefined;
}
