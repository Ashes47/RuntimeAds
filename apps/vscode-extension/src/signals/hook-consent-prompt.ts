import type { ExtensionContext } from "vscode";
import { window } from "vscode";

import type { AttentionRuntime } from "@runtimeads/runtime";

import type { ClaudeCodeWebviewService } from "../rendering/claude-code-webview-service";
import type { CodexWebviewService } from "../rendering/codex-webview-service";
import type { ClaudeCliSyncService } from "./claude-cli-sync";
import type { ClaudeHookServerHandle } from "./claude-hook-server";
import { areTerminalHooksInstalled, installTerminalHooks } from "./terminal-hook-installer";

export const HOOKS_CONSENT_GRANTED_KEY = "runtimeads.hooks.consentGranted";
export const HOOKS_NEVER_PROMPT_KEY = "runtimeads.hooks.neverPrompt";

/**
 * One-time global setup consent. Hooks are installed user-globally (into ~/.claude / ~/.codex),
 * so this no longer needs an open workspace and is asked once per machine. Accepting installs the
 * hooks; "Don't ask again" suppresses it permanently. State lives in globalState (machine-wide).
 */
export async function promptForHookConsent(
  context: ExtensionContext,
  runtime: AttentionRuntime,
  endpoint: ClaudeHookServerHandle,
  claudeWebviewService?: ClaudeCodeWebviewService,
  codexWebviewService?: CodexWebviewService,
  claudeCliSyncService?: ClaudeCliSyncService,
): Promise<void> {
  if (context.globalState.get<boolean>(HOOKS_NEVER_PROMPT_KEY)) {
    return;
  }
  if (context.globalState.get<boolean>(HOOKS_CONSENT_GRANTED_KEY)) {
    return;
  }
  if (await areTerminalHooksInstalled()) {
    await context.globalState.update(HOOKS_CONSENT_GRANTED_KEY, true);
    return;
  }

  const choice = await window.showInformationMessage(
    "RuntimeAds can connect to Claude Code and Codex to detect when your AI is waiting and show a sponsor ad during that time — so you earn while you wait. It adds one hook to your Claude & Codex config (once, globally) and never reads your prompts, code, or terminal output.",
    { modal: true },
    "Set up Claude & Codex",
    "Don't ask again",
  );

  if (choice === "Set up Claude & Codex") {
    try {
      await installTerminalHooks(
        context,
        runtime,
        endpoint,
        claudeWebviewService,
        codexWebviewService,
        claudeCliSyncService,
      );
      await context.globalState.update(HOOKS_CONSENT_GRANTED_KEY, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown hook install error";
      void window.showErrorMessage(`Could not set up Claude & Codex: ${message}`);
    }
    return;
  }

  if (choice === "Don't ask again") {
    await context.globalState.update(HOOKS_NEVER_PROMPT_KEY, true);
  }
}
