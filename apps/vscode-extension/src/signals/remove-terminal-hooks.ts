// Terminal-hook removal. Kept free of any `vscode` import so it can be called both from the
// extension host (the "Remove" command) and from the standalone `vscode:uninstall` hook
// (src/uninstall.ts), which runs as a plain Node process. Only strips RuntimeAds-injected hook
// entries — it never deletes a user's file, except an agent settings file that RuntimeAds created
// and that becomes empty once our entries are removed. `removeGlobalHooks` reverses the current
// global install; `removeTerminalHooks` cleans up any legacy per-workspace install.

import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  claudeSettingsPath,
  codexHooksPath,
  globalHooksDir,
  isRuntimeAdsHookWrapper,
} from "./deploy-hook-relay";
import { RELAY_HOOK_SCRIPT } from "./hook-constants";

export interface RemoveTerminalHooksResult {
  removedFiles: string[];
  rewrittenSettings: string[];
}

/**
 * Reverses the GLOBAL hook install: strips RuntimeAds hook groups from the user-global
 * `~/.claude/settings.json` and `~/.codex/hooks.json` (preserving any of the user's own
 * settings), then deletes the `~/.runtimeads/hooks` script directory.
 */
export async function removeGlobalHooks(): Promise<RemoveTerminalHooksResult> {
  const removedFiles: string[] = [];
  const rewrittenSettings: string[] = [];

  for (const settingsPath of [claudeSettingsPath(), codexHooksPath()]) {
    const existing = await readJsonFile(settingsPath);
    if (Object.keys(existing).length === 0) {
      continue;
    }
    const { settings, changed } = stripRuntimeAdsHooks(existing);
    if (!changed) {
      continue;
    }
    if (Object.keys(settings).length === 0) {
      if (await rmIfExists(settingsPath)) {
        removedFiles.push(settingsPath);
      }
    } else {
      await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      rewrittenSettings.push(settingsPath);
    }
  }

  try {
    await rm(globalHooksDir(), { recursive: true, force: true });
    removedFiles.push(globalHooksDir());
  } catch {
    // Best-effort.
  }

  return { removedFiles, rewrittenSettings };
}

/**
 * Legacy per-workspace cleanup: strips RuntimeAds hook groups from `<ws>/.claude/settings.json`
 * and `<ws>/.codex/hooks.json`, deletes the deployed wrapper/relay scripts, and removes the agent
 * directories if they end up empty. Used to clean up installs from older (per-workspace) builds.
 */
export async function removeTerminalHooks(
  workspaceRoot: string,
): Promise<RemoveTerminalHooksResult> {
  const removedFiles: string[] = [];
  const rewrittenSettings: string[] = [];

  const targets: Array<{ dir: ".claude" | ".codex"; settingsFile: string; wrapper: string }> = [
    { dir: ".claude", settingsFile: "settings.json", wrapper: "runtimeads-claude-hook.sh" },
    { dir: ".codex", settingsFile: "hooks.json", wrapper: "runtimeads-hook.sh" },
  ];

  for (const target of targets) {
    const dirPath = path.join(workspaceRoot, target.dir);
    const settingsPath = path.join(dirPath, target.settingsFile);

    const existing = await readJsonFile(settingsPath);
    if (Object.keys(existing).length > 0) {
      const { settings, changed } = stripRuntimeAdsHooks(existing);
      if (changed) {
        if (Object.keys(settings).length === 0) {
          await rmIfExists(settingsPath);
          removedFiles.push(settingsPath);
        } else {
          await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
          rewrittenSettings.push(settingsPath);
        }
      }
    }

    for (const fileName of [target.wrapper, RELAY_HOOK_SCRIPT]) {
      const filePath = path.join(dirPath, fileName);
      if (await rmIfExists(filePath)) {
        removedFiles.push(filePath);
      }
    }

    await rmDirIfEmpty(dirPath);
  }

  return { removedFiles, rewrittenSettings };
}

function stripRuntimeAdsHooks(settings: Record<string, unknown>): {
  settings: Record<string, unknown>;
  changed: boolean;
} {
  const hooks =
    settings.hooks && typeof settings.hooks === "object"
      ? (settings.hooks as Record<string, unknown>)
      : undefined;
  if (!hooks) {
    return { settings, changed: false };
  }

  let changed = false;
  const nextHooks: Record<string, unknown> = {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      nextHooks[eventName] = groups;
      continue;
    }

    const filtered = groups.filter((group) => !isRuntimeAdsHookGroup(group));
    if (filtered.length !== groups.length) {
      changed = true;
    }
    if (filtered.length > 0) {
      nextHooks[eventName] = filtered;
    }
  }

  if (!changed) {
    return { settings, changed: false };
  }

  const next = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    next.hooks = nextHooks;
  } else {
    delete next.hooks;
  }
  return { settings: next, changed: true };
}

function isRuntimeAdsHookGroup(group: unknown): boolean {
  if (!group || typeof group !== "object") {
    return false;
  }

  const groupHooks = (group as { hooks?: Array<Record<string, unknown>> }).hooks ?? [];
  return groupHooks.some((hook) => isRuntimeAdsRelayHook(hook));
}

function isRuntimeAdsRelayHook(hook: Record<string, unknown>): boolean {
  const command = typeof hook.command === "string" ? hook.command : "";
  if (isRuntimeAdsHookWrapper(command)) {
    return true;
  }

  const args = Array.isArray(hook.args) ? hook.args : [];
  return args.some((arg) => typeof arg === "string" && arg.includes(RELAY_HOOK_SCRIPT));
}

async function rmIfExists(filePath: string): Promise<boolean> {
  try {
    await rm(filePath, { force: true });
    return existsSync(filePath) ? false : true;
  } catch {
    return false;
  }
}

async function rmDirIfEmpty(dirPath: string): Promise<void> {
  try {
    const entries = await readdir(dirPath);
    if (entries.length === 0) {
      await rm(dirPath, { recursive: false, force: true });
    }
  } catch {
    // Directory missing or not empty — leave it alone.
  }
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
