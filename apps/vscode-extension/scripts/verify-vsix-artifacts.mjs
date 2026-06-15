import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredArtifacts = [
  path.join(extensionRoot, "dist", "extension.cjs"),
  path.join(extensionRoot, "dist", "uninstall.cjs"),
  path.join(extensionRoot, "dist", "sql-wasm.wasm"),
  path.join(extensionRoot, "dist", "dashboard", "dashboard.js"),
  path.join(extensionRoot, "dist", "dashboard", "dashboard.css"),
  path.join(extensionRoot, "dist", "runtimeads-terminal-hook.mjs"),
  path.join(extensionRoot, "dist", "runtimeads-spinner-hold.mjs"),
  path.join(extensionRoot, "dist", "runtimeads-claude-hook.mjs"),
  path.join(extensionRoot, "dist", "claude-code-block.asset.js"),
  path.join(extensionRoot, "dist", "codex-block.asset.js"),
  path.join(extensionRoot, "dist", "runtimeads-cli-statusline.mjs"),
  path.join(extensionRoot, "media", "favicon.png"),
];

for (const artifact of requiredArtifacts) {
  await access(artifact);
}
