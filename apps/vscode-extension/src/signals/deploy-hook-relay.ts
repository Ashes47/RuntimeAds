import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { RELAY_HOOK_SCRIPT } from "./hook-constants";

// RuntimeAds installs its terminal hooks GLOBALLY (user-level), not into each project workspace:
//   scripts → ~/.runtimeads/hooks/   (invisible to the user's repos / git)
//   Claude  → ~/.claude/settings.json   (user settings; loaded for every project)
//   Codex   → ~/.codex/hooks.json       (user-level hooks; loaded even in untrusted projects)
// This keeps the user's workspaces clean and means setup works without an open folder.

export type HookAgent = "claude_code" | "codex_cli";

const WRAPPER_NAMES: Record<HookAgent, string> = {
  claude_code: "runtimeads-claude-hook.sh",
  codex_cli: "runtimeads-codex-hook.sh",
};

/** Hidden, out-of-workspace directory holding the relay + per-agent wrapper scripts. */
export function globalHooksDir(): string {
  return path.join(homedir(), ".runtimeads", "hooks");
}

export function globalRelayScriptPath(): string {
  return path.join(globalHooksDir(), RELAY_HOOK_SCRIPT);
}

export function globalWrapperPath(agent: HookAgent): string {
  return path.join(globalHooksDir(), WRAPPER_NAMES[agent]);
}

/** User-global Claude Code settings file (merged across every project). */
export function claudeSettingsPath(): string {
  return path.join(homedir(), ".claude", "settings.json");
}

/** User-level Codex hooks file (loaded even when a project is untrusted — no /hooks prompt). */
export function codexHooksPath(): string {
  return path.join(homedir(), ".codex", "hooks.json");
}

export interface HookRelay {
  wrapperPath: string;
  scriptPath: string;
}

/** Deploy the relay script + the agent's wrapper into the global hooks dir. */
export async function deployGlobalHookRelay(options: {
  agent: HookAgent;
  extensionPath: string;
  nodeCommand: string;
}): Promise<HookRelay> {
  const dir = globalHooksDir();
  const scriptPath = globalRelayScriptPath();
  const wrapperPath = globalWrapperPath(options.agent);

  await mkdir(dir, { recursive: true });
  await copyFile(path.join(options.extensionPath, "dist", RELAY_HOOK_SCRIPT), scriptPath);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\n# RuntimeAds telemetry hook\nexec "${options.nodeCommand}" "${scriptPath}" "${options.agent}"\n`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);

  return { wrapperPath, scriptPath };
}

/**
 * Recognizes RuntimeAds hook wrappers — including the legacy per-workspace `runtimeads-hook.sh`
 * name so an old workspace install is still detected and cleaned up.
 */
export function isRuntimeAdsHookWrapper(command: string): boolean {
  return (
    command.endsWith("/runtimeads-claude-hook.sh") ||
    command.endsWith("/runtimeads-codex-hook.sh") ||
    command.endsWith("/runtimeads-hook.sh")
  );
}
