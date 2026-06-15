import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExtensionContext } from "vscode";
import { Uri, window } from "vscode";

import type { AttentionRuntime } from "@runtimeads/runtime";

import type { ClaudeCodeWebviewService } from "../rendering/claude-code-webview-service";
import type { CodexWebviewService } from "../rendering/codex-webview-service";
import { formatTechnicalReason } from "../user-messages";
import type { ClaudeCliSyncService } from "./claude-cli-sync";
import { syncSpinnerMessageFromRuntime } from "./claude-hook-display";
import type { ClaudeHookServerHandle } from "./claude-hook-server";
import {
  buildClaudeHookInstallerConfig,
  buildCodexHookInstallerConfig,
} from "./claude-hook-server";
import {
  claudeSettingsPath,
  codexHooksPath,
  deployGlobalHookRelay,
  globalRelayScriptPath,
  globalWrapperPath,
  isRuntimeAdsHookWrapper,
} from "./deploy-hook-relay";
import { RELAY_HOOK_SCRIPT } from "./hook-constants";
import { globalHookIntegrityMismatch } from "./hook-integrity";
import { mergeHookSettings } from "./hook-settings-merge";
import { resolveNodeCommand } from "./resolve-node-command";

// Single-source the hook removal in a vscode-free module so the `vscode:uninstall`
// hook can reuse it; re-exported here for existing callers (e.g. register-commands).
export { removeGlobalHooks, removeTerminalHooks } from "./remove-terminal-hooks";
export type { RemoveTerminalHooksResult } from "./remove-terminal-hooks";

/** Re-deploy global hooks only when they're already installed but stale (files missing or the
 * relay hash no longer matches the bundled manifest). A fresh install is consent-gated elsewhere. */
export async function refreshTerminalHooksIfNeeded(
  context: ExtensionContext,
  endpoint: ClaudeHookServerHandle,
): Promise<boolean> {
  const [claudeExisting, codexExisting] = await Promise.all([
    readJsonFile(claudeSettingsPath()),
    readJsonFile(codexHooksPath()),
  ]);

  if (!hasRuntimeAdsRelayHooks(claudeExisting) && !hasRuntimeAdsRelayHooks(codexExisting)) {
    return false;
  }

  const filesPresent =
    existsSync(globalRelayScriptPath()) &&
    existsSync(globalWrapperPath("claude_code")) &&
    existsSync(globalWrapperPath("codex_cli"));
  if (filesPresent && !(await globalHookIntegrityMismatch(context.extensionPath))) {
    return false;
  }

  await writeGlobalHooks(context, endpoint, claudeExisting, codexExisting);
  return true;
}

/** True when our hooks are registered in the user's global Claude + Codex config. */
export async function areTerminalHooksInstalled(): Promise<boolean> {
  const [claudeSettings, codexHooks] = await Promise.all([
    readJsonFile(claudeSettingsPath()),
    readJsonFile(codexHooksPath()),
  ]);
  return hasRuntimeAdsRelayHooks(claudeSettings) && hasRuntimeAdsRelayHooks(codexHooks);
}

export async function installTerminalHooks(
  context: ExtensionContext,
  runtime: AttentionRuntime,
  endpoint: ClaudeHookServerHandle,
  claudeWebviewService?: ClaudeCodeWebviewService,
  codexWebviewService?: CodexWebviewService,
  claudeCliSyncService?: ClaudeCliSyncService,
): Promise<{ claudeSettingsPath: string; codexHooksPath: string }> {
  const claudeExisting = await readJsonFile(claudeSettingsPath());
  const codexExisting = await readJsonFile(codexHooksPath());
  const paths = await writeGlobalHooks(context, endpoint, claudeExisting, codexExisting);

  await syncSpinnerMessageFromRuntime(runtime);
  if (claudeCliSyncService) {
    const waitingSession = runtime
      .getAgentDetectionService()
      .getSessions()
      .find((session) => session.state === "waiting" && !session.endedAt);
    const allocation = await runtime
      .getDisplayLifecycleService()
      .resolveAllocationForDisplay(waitingSession?.sessionId);
    if (allocation) {
      claudeCliSyncService.syncAllocation(allocation);
    }
  }

  const [claudeWebviewResult, codexWebviewResult] = await Promise.all([
    claudeWebviewService?.applyCurrentAd(true),
    codexWebviewService?.applyCurrentAd(true),
  ]);
  const webviewNotes: string[] = [];
  if (claudeWebviewResult?.ok) {
    webviewNotes.push("Sponsor ads enabled in Claude panel");
  } else if (claudeWebviewResult?.reason) {
    webviewNotes.push(`Claude panel: ${formatTechnicalReason(claudeWebviewResult.reason)}`);
  }
  if (codexWebviewResult?.ok) {
    webviewNotes.push("Sponsor ads enabled in Codex panel");
  } else if (codexWebviewResult?.reason) {
    webviewNotes.push(`Codex panel: ${formatTechnicalReason(codexWebviewResult.reason)}`);
  }
  const webviewNote = webviewNotes.length
    ? ` ${webviewNotes.join(". ")} — reload those panels.`
    : "";

  const choice = await window.showInformationMessage(
    `RuntimeAds is set up for Claude & Codex.${webviewNote} Restart any running \`claude\` or \`codex\` terminal session to start earning during AI wait time.`,
    "Open Claude Settings",
    "Open Codex Hooks",
  );

  if (choice === "Open Claude Settings") {
    await window.showTextDocument(Uri.file(paths.claudeSettingsPath));
  } else if (choice === "Open Codex Hooks") {
    await window.showTextDocument(Uri.file(paths.codexHooksPath));
  }

  return paths;
}

/** Deploy the global relay scripts and merge our hook entries into the user-global config files. */
async function writeGlobalHooks(
  context: ExtensionContext,
  endpoint: ClaudeHookServerHandle,
  claudeExisting: Record<string, unknown>,
  codexExisting: Record<string, unknown>,
): Promise<{ claudeSettingsPath: string; codexHooksPath: string }> {
  const nodeCommand = resolveNodeCommand();
  const [claudeRelay, codexRelay] = await Promise.all([
    deployGlobalHookRelay({
      agent: "claude_code",
      extensionPath: context.extensionPath,
      nodeCommand,
    }),
    deployGlobalHookRelay({
      agent: "codex_cli",
      extensionPath: context.extensionPath,
      nodeCommand,
    }),
  ]);
  const claudeHooks = buildClaudeHookInstallerConfig(
    context.extensionPath,
    endpoint,
    nodeCommand,
    claudeRelay.wrapperPath,
  );
  const codexHooks = buildCodexHookInstallerConfig(
    context.extensionPath,
    endpoint,
    nodeCommand,
    codexRelay.wrapperPath,
  );

  const claudePath = claudeSettingsPath();
  const codexPath = codexHooksPath();
  await Promise.all([
    mkdir(path.dirname(claudePath), { recursive: true }),
    mkdir(path.dirname(codexPath), { recursive: true }),
  ]);
  await writeFile(
    claudePath,
    `${JSON.stringify(mergeHookSettings(claudeExisting, claudeHooks), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    codexPath,
    `${JSON.stringify(mergeHookSettings(codexExisting, codexHooks), null, 2)}\n`,
    "utf8",
  );

  return { claudeSettingsPath: claudePath, codexHooksPath: codexPath };
}

function hasRuntimeAdsRelayHooks(settings: Record<string, unknown>): boolean {
  const hooks =
    settings.hooks && typeof settings.hooks === "object"
      ? (settings.hooks as Record<string, unknown>)
      : {};

  return Object.values(hooks).some((groups) => {
    if (!Array.isArray(groups)) {
      return false;
    }
    return groups.some((group) => {
      if (!group || typeof group !== "object") {
        return false;
      }
      const groupHooks = (group as { hooks?: Array<Record<string, unknown>> }).hooks ?? [];
      return groupHooks.some((hook) => isRuntimeAdsRelayHook(hook));
    });
  });
}

function isRuntimeAdsRelayHook(hook: Record<string, unknown>): boolean {
  const command = typeof hook.command === "string" ? hook.command : "";
  if (isRuntimeAdsHookWrapper(command)) {
    return true;
  }
  const args = Array.isArray(hook.args) ? hook.args : [];
  return args.some((arg) => typeof arg === "string" && arg.includes(RELAY_HOOK_SCRIPT));
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
