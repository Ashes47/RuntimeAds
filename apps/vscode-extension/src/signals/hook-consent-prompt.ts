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
 * Auto-setup on activation. Installing the extension is treated as consent (the prior consent modal
 * is gone), so hooks install automatically into ~/.claude / ~/.codex the first time — no click
 * needed. Idempotent and self-suppressing: no-ops if hooks are already installed, or if the user
 * explicitly opted out (e.g. via "Remove RuntimeAds & Sign Out", which sets the opt-out flag). A
 * single non-blocking toast the first time keeps the change transparent and points at the undo. If
 * setup can't complete now (e.g. Claude/Codex isn't installed yet) the hourly nag retries.
 */
export async function autoSetupHooks(
  context: ExtensionContext,
  runtime: AttentionRuntime,
  endpoint: ClaudeHookServerHandle,
  claudeWebviewService?: ClaudeCodeWebviewService,
  codexWebviewService?: CodexWebviewService,
  claudeCliSyncService?: ClaudeCliSyncService,
): Promise<void> {
  if (context.globalState.get<boolean>(HOOKS_NEVER_PROMPT_KEY)) {
    return; // user explicitly removed / opted out — don't silently re-install
  }
  if (await areTerminalHooksInstalled()) {
    await context.globalState.update(HOOKS_CONSENT_GRANTED_KEY, true);
    return;
  }

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
    void window.showInformationMessage(
      "RuntimeAds is set up for Claude Code & Codex — you'll earn a sponsor ad while your AI thinks. " +
        "Restart any running claude/codex session to pick it up. Undo any time with “Remove RuntimeAds & Sign Out.”",
    );
  } catch {
    // Couldn't set up now (e.g. Claude/Codex not installed yet). Leave the flags untouched so the
    // hourly nag retries — don't mark consent, don't opt out.
  }
}

/**
 * Recurring (hourly) reminder for devs who installed the extension but never set up the terminal
 * hooks — without them their AI-wait time isn't detected, so they earn nothing and the server
 * soft-flags "hook integrity not verifiable" each heartbeat. Non-modal (a gentle toast, not the
 * one-time modal above) and reuses the same consent keys, so "Don't ask again" — from here OR the
 * initial modal — suppresses it permanently. No-ops once hooks are installed/consented.
 */
export async function nagHookSetupIfNeeded(
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
    "RuntimeAds isn't earning yet — set up Claude Code & Codex to show a sponsor ad while your AI thinks. It adds one hook (globally) and never reads your prompts, code, or terminal output.",
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
