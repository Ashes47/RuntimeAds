import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { globalRelayScriptPath } from "./deploy-hook-relay";
import { RELAY_HOOK_SCRIPT } from "./hook-constants";

export interface HookManifest {
  files: Record<string, string>;
}

export interface HookIntegrityResult {
  ok: boolean;
  mismatchedFiles: string[];
  // Actual on-disk hashes keyed by the registry-canonical path the server's expected-hash
  // registry uses (`.claude/<script>` and `.codex/<script>`), so verification works without
  // trusting `ok`. There is now a single physical relay (global), reported under both keys.
  fileHashes: Record<string, string>;
  // ISO timestamp of the relay's mtime, used by the server to correlate impression bursts
  // with hook tampering.
  manifestMtime?: string;
}

let cachedHookIntegrity: HookIntegrityResult | undefined;

export function getCachedHookIntegrity(): HookIntegrityResult | undefined {
  return cachedHookIntegrity;
}

export async function refreshHookIntegrityState(options: {
  extensionPath: string;
}): Promise<HookIntegrityResult> {
  cachedHookIntegrity = await verifyGlobalHookIntegrity(options.extensionPath);
  return cachedHookIntegrity;
}

export async function loadHookManifest(extensionPath: string): Promise<HookManifest> {
  const manifestPath = path.join(extensionPath, "dist", "hook-manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as HookManifest;
}

export async function sha256File(filePath: string): Promise<string> {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Verify the global relay script against the bundled manifest. The server's expected-hash
 * registry is keyed by `.claude/<script>` / `.codex/<script>`, so we report the single relay
 * hash under both keys to keep server-side verification unchanged.
 */
export async function verifyGlobalHookIntegrity(
  extensionPath: string,
): Promise<HookIntegrityResult> {
  const manifest = await loadHookManifest(extensionPath);
  const expected = manifest.files[RELAY_HOOK_SCRIPT];
  if (!expected) {
    return { ok: true, mismatchedFiles: [], fileHashes: {} };
  }

  const registryKeys = [`.claude/${RELAY_HOOK_SCRIPT}`, `.codex/${RELAY_HOOK_SCRIPT}`];
  const relayPath = globalRelayScriptPath();
  try {
    const [actual, stats] = await Promise.all([sha256File(relayPath), stat(relayPath)]);
    const fileHashes = Object.fromEntries(registryKeys.map((key) => [key, actual]));
    const manifestMtime = new Date(stats.mtimeMs).toISOString();
    return {
      ok: actual === expected,
      mismatchedFiles: actual === expected ? [] : [relayPath],
      fileHashes,
      manifestMtime,
    };
  } catch {
    return { ok: false, mismatchedFiles: [relayPath], fileHashes: {} };
  }
}

export async function globalHookIntegrityMismatch(extensionPath: string): Promise<boolean> {
  const result = await verifyGlobalHookIntegrity(extensionPath);
  return !result.ok;
}
