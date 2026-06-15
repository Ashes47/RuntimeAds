// P1-26: `vscode:uninstall` hook. VS Code runs this standalone Node script (NOT in the
// extension host) when the user removes the extension from the Extensions panel, so it must
// NOT import `vscode`. It restores the editor surfaces RuntimeAds patched — Claude Code + Codex
// webview panels and the global Claude/Codex CLI surfaces — using the same vscode-free
// patchers/locators the runtime uses. Best-effort: each step is isolated so one failure does
// not block the others. Mirrors Kickbacks PR #98 (restorePatchedSurfaces).
//
// Workspace-scoped terminal hooks are cleaned via the registry the extension maintains at
// ~/.runtimeads/patched-workspaces.json (see patched-workspaces.ts): each workspace it patched is
// recorded, so this hook can strip those hooks even though it can't enumerate open workspaces.

import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeWebviewPatcher } from "./rendering/claude-code-patcher";
import { locateClaudeCodeWebviewTarget } from "./rendering/claude-code-locator";
import { listAllCodexWebviewTargets } from "./rendering/codex-locator";
import { CodexWebviewPatcher } from "./rendering/codex-patcher";
import { ClaudeCliSyncService } from "./signals/claude-cli-sync";
import { CodexCliSyncService } from "./signals/codex-cli-sync";
import { listPatchedWorkspaces } from "./signals/patched-workspaces";
import { removeGlobalHooks, removeTerminalHooks } from "./signals/remove-terminal-hooks";

// restore() does not use the asset path; a placeholder keeps the patcher constructors happy.
const NO_ASSET = "";

function restoreClaudeWebview(): void {
  const target = locateClaudeCodeWebviewTarget();
  if (target) {
    new ClaudeCodeWebviewPatcher(target, NO_ASSET).restore();
  }
}

function restoreCodexWebviews(): void {
  for (const target of listAllCodexWebviewTargets()) {
    new CodexWebviewPatcher(target, NO_ASSET).restore();
  }
}

function restoreCliSurfaces(): void {
  // extensionPath is only used when writing ad surfaces; restore reads global paths.
  new ClaudeCliSyncService("").restore();
  new CodexCliSyncService("").restore();
}

async function restoreTerminalHooks(): Promise<void> {
  // Strip our hook entries from the user-global ~/.claude/settings.json and ~/.codex/hooks.json
  // (the global hook SCRIPTS under ~/.runtimeads/hooks are wiped by removeRuntimeadsHome below).
  try {
    await removeGlobalHooks();
  } catch {
    // Best-effort.
  }
  // Clean up any leftover per-workspace installs from older (pre-global) builds. Best-effort:
  // a missing/moved repo is skipped, never aborting the others.
  for (const workspaceRoot of listPatchedWorkspaces()) {
    try {
      await removeTerminalHooks(workspaceRoot);
    } catch {
      // Skip this workspace; continue with the rest.
    }
  }
}

function removeRuntimeadsHome(): void {
  // Everything under ~/.runtimeads is RuntimeAds-owned ephemeral state (ad cache, statusline script,
  // codex ad/shim metadata, hook-server endpoint files, the patched-workspaces registry, cached
  // icons, logs). Removed LAST — after the CLI/codex restores and the workspace sweep have read
  // what they need from it — so an uninstall leaves no RuntimeAds files behind.
  rmSync(join(homedir(), ".runtimeads"), { recursive: true, force: true });
}

export async function runUninstall(): Promise<void> {
  for (const step of [restoreClaudeWebview, restoreCodexWebviews, restoreCliSurfaces]) {
    try {
      step();
    } catch {
      // Best-effort cleanup — never throw out of the uninstall hook.
    }
  }
  try {
    await restoreTerminalHooks();
  } catch {
    // Best-effort.
  }
  // Final: purge the RuntimeAds home dir (registry was just read by the workspace sweep above).
  try {
    removeRuntimeadsHome();
  } catch {
    // Best-effort.
  }
}

// VS Code invokes this file directly (`node ./dist/uninstall.cjs`); run only as the entrypoint
// so tests can import runUninstall() without triggering global filesystem restores.
if (require.main === module) {
  void runUninstall();
}
