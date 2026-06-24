import { access, readFile } from "node:fs/promises";
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
  path.join(extensionRoot, "dist", "codex-cli-wrapper.sh.asset"),
  path.join(extensionRoot, "dist", "codex-cli-wrapper.cmd.asset"),
  path.join(extensionRoot, "media", "favicon.png"),
];

for (const artifact of requiredArtifacts) {
  await access(artifact);
}

// Security regression guard: the codex banner text is advertiser-controlled. Neither
// wrapper may pass it through a shell/cmd parser (which would let `&`, `|`, `>`, `^`,
// `$(...)` etc. execute as commands). Assert the injection-safe shapes hold.
const cmdWrapper = await readFile(
  path.join(extensionRoot, "dist", "codex-cli-wrapper.cmd.asset"),
  "utf8",
);
// `echo %AD_TEXT%` / `echo %AD_FILE%` expand unquoted at parse time -> command injection.
if (/echo\b[^\r\n]*%AD_(TEXT|FILE)%/i.test(cmdWrapper)) {
  throw new Error(
    "codex-cli-wrapper.cmd.asset echoes advertiser-controlled text through the cmd parser " +
      "(command injection). Emit the file with `type` instead.",
  );
}
if (!/\btype\s+"%AD_FILE%"/i.test(cmdWrapper)) {
  throw new Error(
    'codex-cli-wrapper.cmd.asset must render the banner via `type "%AD_FILE%"` (no shell parsing).',
  );
}

const shWrapper = await readFile(
  path.join(extensionRoot, "dist", "codex-cli-wrapper.sh.asset"),
  "utf8",
);
// AD_TEXT must only ever be the quoted %s argument to a fixed printf format.
if (!/printf '[^']*%s[^']*' "\$AD_TEXT"/.test(shWrapper)) {
  throw new Error(
    "codex-cli-wrapper.sh.asset must print the banner via `printf '...%s...' \"$AD_TEXT\"` " +
      "(fixed format, quoted arg).",
  );
}
if (/\$\(\s*[^)]*\$AD_TEXT|`[^`]*\$AD_TEXT|eval[^\r\n]*\$AD_TEXT/.test(shWrapper)) {
  throw new Error(
    "codex-cli-wrapper.sh.asset must not place $AD_TEXT in a command-substitution or eval position.",
  );
}
