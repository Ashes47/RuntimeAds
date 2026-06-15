import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { env, Uri } from "vscode";

const execFileAsync = promisify(execFile);

const HTTP_URL_RE = /^https?:\/\//i;

export function isHttpUrl(value: string): boolean {
  return HTTP_URL_RE.test(value);
}

/** Open in the default browser from the extension host (not a VS Code webview). */
export async function openUrlInSystemBrowser(url: string): Promise<void> {
  if (!isHttpUrl(url)) {
    return;
  }

  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", [url]);
      return;
    }
    if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url], { shell: true });
      return;
    }
    await execFileAsync("xdg-open", [url]);
  } catch {
    await env.openExternal(Uri.parse(url));
  }
}
