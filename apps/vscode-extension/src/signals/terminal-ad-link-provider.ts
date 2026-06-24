import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RenderSurface } from "@runtimeads/sdk-contracts";
import type { AttentionRuntime } from "@runtimeads/runtime";

import type { ExtensionContext, TerminalLink, TerminalLinkProvider } from "vscode";
import { window } from "vscode";

import { openUrlInSystemBrowser } from "./open-system-browser";

const FRESH_MS = 10 * 60 * 1000;

interface CliAdCache {
  adText: string;
  clickUrl: string;
  destinationUrl?: string;
  allocationId: string;
  ts: number;
}

type RuntimeAdsTerminalLink = TerminalLink & {
  url: string;
  surface: RenderSurface;
};

function cachePath(): string {
  return join(homedir(), ".runtimeads", "cli-ad.json");
}

function readCliAdCache(): CliAdCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as Partial<CliAdCache>;
    if (
      !parsed ||
      typeof parsed.ts !== "number" ||
      Date.now() - parsed.ts > FRESH_MS ||
      typeof parsed.adText !== "string" ||
      typeof parsed.clickUrl !== "string" ||
      typeof parsed.allocationId !== "string"
    ) {
      return undefined;
    }

    return {
      adText: parsed.adText,
      clickUrl: parsed.clickUrl,
      ...(typeof parsed.destinationUrl === "string"
        ? { destinationUrl: parsed.destinationUrl }
        : {}),
      allocationId: parsed.allocationId,
      ts: parsed.ts,
    };
  } catch {
    return undefined;
  }
}

async function recordTerminalAdClick(
  runtime: AttentionRuntime,
  cache: CliAdCache,
  surface: RenderSurface,
): Promise<void> {
  const session = runtime
    .getAgentDetectionService()
    .getSessions()
    .find((entry) => entry.state === "waiting" && !entry.endedAt);

  await runtime
    .getDisplayLifecycleService()
    .recordClick(surface, cache.allocationId, session?.sessionId);
}

function resolveOpenUrl(cache: CliAdCache): string {
  return cache.destinationUrl ?? cache.clickUrl;
}

function pushLink(
  links: RuntimeAdsTerminalLink[],
  line: string,
  needle: string,
  url: string,
  surface: RenderSurface,
): void {
  const startIndex = line.indexOf(needle);
  if (startIndex < 0) {
    return;
  }

  links.push({
    startIndex,
    length: needle.length,
    tooltip: "Open sponsor link",
    url,
    surface,
  });
}

export function registerTerminalAdLinkProvider(
  context: ExtensionContext,
  runtime: AttentionRuntime,
): void {
  const provider: TerminalLinkProvider<RuntimeAdsTerminalLink> = {
    provideTerminalLinks(context) {
      const cache = readCliAdCache();
      if (!cache) {
        return [];
      }

      const line = context.line;
      const links: RuntimeAdsTerminalLink[] = [];
      const plainAd = cache.adText.replace(/\s*↗\s*$/, "").trim();

      pushLink(links, line, cache.clickUrl, resolveOpenUrl(cache), "cli_status_line");
      if (plainAd) {
        pushLink(links, line, plainAd, resolveOpenUrl(cache), "cli_spinner_verb");
      }

      return links;
    },
    handleTerminalLink(link) {
      const cache = readCliAdCache();
      if (!cache) {
        void openUrlInSystemBrowser(link.url);
        return;
      }

      void recordTerminalAdClick(runtime, cache, link.surface).then(() =>
        openUrlInSystemBrowser(link.url),
      );
    },
  };

  context.subscriptions.push(window.registerTerminalLinkProvider(provider));
}
