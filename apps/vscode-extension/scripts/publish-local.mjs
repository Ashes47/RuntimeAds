/* global console, process */

// Publish the RuntimeAds extension from your machine — the same pipeline as
// .github/workflows/publish-extension.yml, for when you can't (or don't want to) go through CI.
//
// It packages the current package.json version into a VSIX (build + artifact verify + vsce
// package), then publishes that one artifact to BOTH the VS Code Marketplace (vsce) and Open VSX
// (ovsx). Tokens are read from the environment so they never appear in the command line / logs:
//   VSCE_PAT  – Azure DevOps PAT for the `runtimeads` Marketplace publisher (or run `vsce login`)
//   OVSX_PAT  – Open VSX access token for the `runtimeads` namespace
//
// Usage (from repo root):  pnpm --filter runtimeads publish:local [flags]
//   --dry-run      Build + package only; do not publish to any registry.
//   --skip-build   Reuse an already-built runtimeads-<version>.vsix instead of rebuilding.
//   --vsce-only    Publish to the VS Code Marketplace only.
//   --ovsx-only    Publish to Open VSX (Cursor) only.
//
// Bump the version in package.json BEFORE running (the VSIX filename + listing use it):
//   cd apps/vscode-extension && npm version patch --no-git-tag-version   # 0.1.0 → 0.1.1
// Use --no-git-tag-version: a v* tag would also trigger CI to publish the SAME version again.
// vsce/ovsx reject re-publishing a version that already exists, so that's the guard. The same VSIX
// goes to both registries (versions stay in lockstep); if one fails, re-run --vsce-only/--ovsx-only
// at the same version. Commit the bump to main afterward so the source of truth keeps advancing.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipBuild = args.has("--skip-build");
const vsceOnly = args.has("--vsce-only");
const ovsxOnly = args.has("--ovsx-only");

const pkg = JSON.parse(readFileSync(path.join(extDir, "package.json"), "utf8"));
const { version } = pkg;
const vsix = path.join(extDir, `runtimeads-${version}.vsix`);

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: extDir, stdio: "inherit" });
}

console.log(`RuntimeAds local publish — v${version}${dryRun ? " (dry run)" : ""}`);

// 1. Build + package the VSIX (build + verify-vsix-artifacts + vsce package), unless reusing one.
if (skipBuild) {
  if (!existsSync(vsix)) {
    throw new Error(`--skip-build set but ${vsix} not found. Run once without --skip-build first.`);
  }
  console.log(`Reusing existing VSIX: ${vsix}`);
} else {
  run("pnpm package");
}

if (!existsSync(vsix)) {
  throw new Error(`Expected VSIX not found: ${vsix}`);
}

if (dryRun) {
  console.log(`\nDry run complete — VSIX ready at ${vsix}. Nothing was published.`);
  process.exit(0);
}

// 2. Publish to the registries (mirrors CI). vsce reads VSCE_PAT and ovsx reads OVSX_PAT from the
//    environment, so the tokens are never passed as CLI args.
if (!ovsxOnly) {
  if (!process.env.VSCE_PAT) {
    throw new Error(
      "Missing VSCE_PAT. Export the Azure DevOps PAT, or run `pnpm --filter runtimeads exec vsce login runtimeads`.",
    );
  }
  run(`pnpm exec vsce publish --packagePath "${vsix}"`);
}

if (!vsceOnly) {
  if (!process.env.OVSX_PAT) {
    throw new Error(
      "Missing OVSX_PAT. Export the Open VSX access token for the runtimeads namespace.",
    );
  }
  run(`pnpm exec ovsx publish "${vsix}"`);
}

console.log(`\nPublished runtimeads ${version}.`);
console.log(
  "Ops follow-up (runbook §8): bump EXTENSION_LATEST_VERSION in .env.production + redeploy; if the",
);
console.log(
  "hook changed, run `pnpm ops:seed-hook-manifest`; then smoke-test the version gate (426 for old).",
);
