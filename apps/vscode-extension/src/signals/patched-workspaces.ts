// Registry of workspace roots whose terminal hooks RuntimeAds has modified. The standalone
// `vscode:uninstall` hook can't enumerate every workspace the user ever opened, so the
// extension records each one here as it patches it. The registry lives under ~/.runtimeads
// (homedir-based, resolvable without the `vscode` API and across editor forks, and removed
// by the uninstall hook anyway) — NOT in editor globalStorage, which the standalone hook
// can't reliably locate. Kept free of any `vscode` import for the same reason.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function runtimeadsDir(): string {
  return path.join(homedir(), ".runtimeads");
}

function registryPath(): string {
  return path.join(runtimeadsDir(), "patched-workspaces.json");
}

/** Normalize so the same workspace dedupes regardless of trailing slash / relative form. */
function normalize(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

export function listPatchedWorkspaces(): string[] {
  try {
    const raw = readFileSync(registryPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function writeAll(workspaces: string[]): void {
  mkdirSync(runtimeadsDir(), { recursive: true });
  // Atomic-ish write (temp + rename) so concurrent readers never see a partial file.
  const target = registryPath();
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(workspaces, null, 2)}\n`, "utf8");
  renameSync(tmp, target);
}

/** Record a workspace as patched. Read-merge-write + dedupe so concurrent windows don't clobber. */
export function recordPatchedWorkspace(workspaceRoot: string): void {
  try {
    const entry = normalize(workspaceRoot);
    const current = listPatchedWorkspaces().map(normalize);
    if (current.includes(entry)) {
      return;
    }
    writeAll([...current, entry]);
  } catch {
    // Best-effort: failing to record must never break hook installation.
  }
}

/** Drop a workspace from the registry (after its hooks are removed). */
export function removePatchedWorkspace(workspaceRoot: string): void {
  try {
    if (!existsSync(registryPath())) {
      return;
    }
    const entry = normalize(workspaceRoot);
    const next = listPatchedWorkspaces()
      .map(normalize)
      .filter((existing) => existing !== entry);
    writeAll(next);
  } catch {
    // Best-effort.
  }
}
