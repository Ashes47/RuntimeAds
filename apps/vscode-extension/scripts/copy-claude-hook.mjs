import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinationDir = path.join(extensionRoot, "dist");

await mkdir(destinationDir, { recursive: true });

const hookFiles = ["runtimeads-terminal-hook.mjs"];

for (const fileName of [
  ...hookFiles,
  "runtimeads-spinner-hold.mjs",
  "runtimeads-claude-hook.mjs",
  "claude-code-block.asset.js",
  "codex-block.asset.js",
]) {
  await copyFile(
    path.join(extensionRoot, "scripts", fileName),
    path.join(destinationDir, fileName),
  );
}

const manifest = { files: {} };
for (const fileName of hookFiles) {
  const contents = await readFile(path.join(destinationDir, fileName));
  manifest.files[fileName] = createHash("sha256").update(contents).digest("hex");
}
await writeFile(
  path.join(destinationDir, "hook-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

await copyFile(
  path.join(extensionRoot, "scripts", "claude-cli-statusline.asset.mjs"),
  path.join(destinationDir, "runtimeads-cli-statusline.mjs"),
);

for (const fileName of ["codex-cli-wrapper.sh.asset", "codex-cli-wrapper.cmd.asset"]) {
  await copyFile(
    path.join(extensionRoot, "scripts", fileName),
    path.join(destinationDir, fileName),
  );
}
