import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { HOST_EXTENSION_ROOTS } from "./webview-host";

export function locateClaudeCodeWebviewTarget(): string | null {
  const override = process.env.RUNTIMEADS_CLAUDE_CODE_WEBVIEW_TARGET;
  if (override) {
    return existsSync(override) ? override : null;
  }

  for (const root of HOST_EXTENSION_ROOTS) {
    try {
      if (!existsSync(root)) {
        continue;
      }

      const matches: string[] = [];
      for (const entry of readdirSync(root)) {
        if (!entry.startsWith("anthropic.claude-code-")) {
          continue;
        }

        const candidate = join(root, entry, "webview", "index.js");
        if (existsSync(candidate)) {
          matches.push(candidate);
        }
      }

      if (matches.length > 0) {
        matches.sort();
        return matches[matches.length - 1] ?? null;
      }
    } catch {
      // Try the next host root.
    }
  }

  return null;
}

/**
 * Every Claude Code webview bundle across all editor roots (VS Code / Cursor / Windsurf / Insiders)
 * and all installed versions — the mirror of `listAllCodexWebviewTargets()`. Serving patches a
 * single target (`locateClaudeCodeWebviewTarget`); restore/uninstall must touch them ALL so a kill
 * or uninstall leaves no patched bundle behind on any install.
 */
export function listAllClaudeCodeWebviewTargets(): string[] {
  const override = process.env.RUNTIMEADS_CLAUDE_CODE_WEBVIEW_TARGET;
  if (override) {
    return existsSync(override) ? [override] : [];
  }

  const targets: string[] = [];
  for (const root of HOST_EXTENSION_ROOTS) {
    try {
      if (!existsSync(root)) {
        continue;
      }

      for (const entry of readdirSync(root)) {
        if (!entry.startsWith("anthropic.claude-code-")) {
          continue;
        }

        const candidate = join(root, entry, "webview", "index.js");
        if (existsSync(candidate)) {
          targets.push(candidate);
        }
      }
    } catch {
      // Try the next host root.
    }
  }

  return [...new Set(targets)].sort();
}

export function locateClaudeCodeExtensionJs(webviewTarget: string): string | null {
  const sibling = join(webviewTarget, "..", "..", "extension.js");
  return existsSync(sibling) ? sibling : null;
}
