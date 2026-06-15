import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** Editor extension roots scanned to locate Claude Code / Codex webview bundles. */
export const HOST_EXTENSION_ROOTS = [
  ".cursor",
  ".cursor-server",
  ".vscode",
  ".vscode-server",
  ".vscode-server-insiders",
].map((dir) => join(homedir(), dir, "extensions"));

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
