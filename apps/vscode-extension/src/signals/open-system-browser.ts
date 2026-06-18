import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { env, Uri } from "vscode";

const execFileAsync = promisify(execFile);

/** A valid http(s) URL, or null. Validates the whole URL (not just the scheme prefix), so
 * shell metacharacters / non-URLs can never flow into an OS launcher. */
function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  return parseHttpUrl(value) !== null;
}

/** Open in the default browser from the extension host (not a VS Code webview).
 *
 * Ext H1: use VS Code's `env.openExternal` (ShellExecute under the hood — no shell parsing)
 * as the primary path on every platform. The optional OS fallbacks pass the URL as a single
 * argv with NO shell, so a backend-supplied URL can't inject commands (the old Windows
 * `cmd … {shell:true}` path is removed entirely). */
export async function openUrlInSystemBrowser(url: string): Promise<void> {
  const parsed = parseHttpUrl(url);
  if (parsed === null) {
    return;
  }
  const safeUrl = parsed.toString();

  try {
    if (await env.openExternal(Uri.parse(safeUrl))) {
      return;
    }
  } catch {
    // Fall through to a shell-free OS launcher.
  }

  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", [safeUrl]);
    } else if (process.platform !== "win32") {
      await execFileAsync("xdg-open", [safeUrl]);
    }
    // Windows has no fallback: env.openExternal is the only safe launcher (no `cmd`).
  } catch {
    // Best-effort; give up silently.
  }
}
