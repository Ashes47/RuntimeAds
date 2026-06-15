import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(extensionDir, "package.json"), "utf8"));
// Matches `vsce package` default output: <name>-<version>.vsix
const vsix = path.join(extensionDir, `${pkg.name}-${pkg.version}.vsix`);
const cli = process.argv[2] ?? "cursor";
const uninstallFirst = process.argv.includes("--uninstall-first");

if (!existsSync(vsix)) {
  console.error(`VSIX not found:\n  ${vsix}`);
  console.error("\nBuild it first (from repo root):");
  console.error("  pnpm extension:package");
  process.exit(1);
}

if (uninstallFirst) {
  try {
    execSync(`${cli} --uninstall-extension runtimeads.runtimeads`, { stdio: "ignore" });
  } catch {
    // Extension may not be installed yet.
  }
}

console.log(`Installing ${vsix}`);
execSync(`${cli} --install-extension "${vsix}"`, { stdio: "inherit" });
console.log("Done. Reload the window: Developer: Reload Window");
