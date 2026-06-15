import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { HOST_EXTENSION_ROOTS } from "./webview-host";

export function locateCodexWebviewTarget(): string | null {
  const targets = listAllCodexWebviewTargets();
  return targets[targets.length - 1] ?? null;
}

export function listAllCodexWebviewTargets(): string[] {
  const override = process.env.RUNTIMEADS_CODEX_WEBVIEW_TARGET;
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
        if (!entry.startsWith("openai.chatgpt-")) {
          continue;
        }

        const assetsDir = join(root, entry, "webview", "assets");
        if (!existsSync(assetsDir)) {
          continue;
        }

        for (const asset of readdirSync(assetsDir)) {
          if (asset.startsWith("thinking-shimmer-") && asset.endsWith(".js")) {
            targets.push(join(assetsDir, asset));
          }
        }
      }
    } catch {
      // Try the next host root.
    }
  }

  return [...new Set(targets)].sort(compareCodexWebviewTargets);
}

function compareCodexWebviewTargets(left: string, right: string): number {
  const leftVersion = parseCodexExtensionVersion(left);
  const rightVersion = parseCodexExtensionVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftVersion[index] ?? 0;
    const rightPart = rightVersion[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return left.localeCompare(right);
}

function parseCodexExtensionVersion(targetPath: string): [number, number, number] {
  const match = targetPath.match(/openai\.chatgpt-(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [0, 0, 0];
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function locateCodexExtensionJs(webviewTarget: string): string | null {
  const extensionRoot = join(webviewTarget, "..", "..", "..");
  for (const candidate of [
    join(extensionRoot, "out", "extension.js"),
    join(extensionRoot, "extension.js"),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
