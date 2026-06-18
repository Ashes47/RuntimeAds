/* global console, process */

// Build step: record the current extension version's hook-file hash into the backend's committed
// hook-hashes manifest (apps/api/config/hook-hashes.json). The API self-seeds that manifest into
// hook_hash_registry on startup, so this replaces the manual `ops:seed-hook-manifest` run — you
// just commit the updated file alongside the version bump and the next backend deploy picks it up.
//
// Runs inside `pnpm package` (after `pnpm build` produces dist/hook-manifest.json). Idempotent:
// re-running with the same version+hash is a no-op. Review the git diff before committing.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(extDir, "..", "..");
const manifestPath = path.join(extDir, "dist", "hook-manifest.json");
const hashesPath = path.join(repoRoot, "apps", "api", "config", "hook-hashes.json");

const version = JSON.parse(readFileSync(path.join(extDir, "package.json"), "utf8")).version;
const sha = JSON.parse(readFileSync(manifestPath, "utf8"))?.files?.["runtimeads-terminal-hook.mjs"];

if (typeof sha !== "string" || sha.length === 0) {
  throw new Error(`No hook hash in ${manifestPath}. Build the extension first (pnpm build).`);
}

const hashes = JSON.parse(readFileSync(hashesPath, "utf8"));
hashes.versions ??= {};

if (hashes.versions[version] === sha) {
  console.log(`hook-hashes.json already current for v${version} (${sha.slice(0, 12)}…)`);
  process.exit(0);
}

// Update in place (preserves existing versions + their insertion order; appends new ones).
hashes.versions[version] = sha;
writeFileSync(hashesPath, `${JSON.stringify(hashes, null, 2)}\n`);
console.log(`hook-hashes.json updated: v${version} -> ${sha.slice(0, 12)}…  — commit this file.`);
