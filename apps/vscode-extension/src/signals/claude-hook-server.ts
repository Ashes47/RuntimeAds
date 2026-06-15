import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Agent, CachedAllocation, RenderSurface } from "@runtimeads/sdk-contracts";
import type { AttentionRuntime } from "@runtimeads/runtime";
import { extractTerminalHookMetadata, mapTerminalHookToObservation } from "@runtimeads/runtime";

import { syncDisplaySurfacesFromRuntime } from "./claude-hook-display";
import { openUrlInSystemBrowser } from "./open-system-browser";
import { resolveCampaignIconDataUrl } from "./campaign-icon-cache";
import { ensurePatchAllocation } from "../rendering/resolve-display-allocation";
import { RELAY_HOOK_SCRIPT } from "./hook-constants";
import { reportTerminalActivity } from "./terminal-hook-bridge";

const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "Notification",
] as const;

const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
] as const;

export interface ClaudeHookServerHandle {
  port: number;
  token: string;
  url: string;
  webviewBaseUrl: string;
  dispose(): Promise<void>;
}

export async function startClaudeHookServer(
  runtime: AttentionRuntime,
): Promise<ClaudeHookServerHandle> {
  // TD-028: keep a STABLE loopback identity across restarts. The webview blocks bake the
  // loopback base (port + token) at patch time, so a fresh random port/token each start left
  // already-patched panels pointing at a dead endpoint (clicks silently failed). Reuse the
  // persisted token and try to re-bind the persisted port; fall back to ephemeral if it's taken.
  const persisted = await readHookEndpointConfig();
  const token = persisted?.token ?? randomBytes(24).toString("base64url");

  const hookServer = createServer((request, response) => {
    void handleRequest(request, response, runtime, token);
  });

  await listenWithFallback(hookServer, persisted?.port);

  const address = hookServer.address();
  if (!address || typeof address === "string") {
    throw new Error("RuntimeAds terminal hook server failed to bind");
  }

  const url = `http://127.0.0.1:${address.port}/v1/hooks/terminal`;
  const webviewBaseUrl = `http://127.0.0.1:${address.port}/v1/webview/${token}`;
  await writeHookEndpointConfig({ url, token, port: address.port });

  return {
    port: address.port,
    token,
    url,
    webviewBaseUrl,
    dispose: async () => {
      await new Promise<void>((resolve, reject) => {
        hookServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

export function buildClaudeHookInstallerConfig(
  extensionPath: string,
  _endpoint: { url: string; token: string },
  nodeCommand: string = "node",
  hookCommand?: string,
): Record<string, unknown> {
  return buildTerminalHookInstallerConfig({
    extensionPath,
    agent: "claude_code",
    events: CLAUDE_HOOK_EVENTS,
    nodeCommand,
    ...(hookCommand ? { hookCommand } : {}),
  });
}

export function buildCodexHookInstallerConfig(
  extensionPath: string,
  _endpoint: { url: string; token: string },
  nodeCommand: string = "node",
  hookCommand?: string,
): Record<string, unknown> {
  return buildTerminalHookInstallerConfig({
    extensionPath,
    agent: "codex_cli",
    events: CODEX_HOOK_EVENTS,
    nodeCommand,
    ...(hookCommand ? { hookCommand } : {}),
  });
}

export function buildTerminalHookInstallerConfig(options: {
  extensionPath: string;
  agent: Agent;
  events: readonly string[];
  nodeCommand: string;
  hookCommand?: string;
}): Record<string, unknown> {
  const relayScriptPath = path.join(options.extensionPath, "dist", RELAY_HOOK_SCRIPT);

  const hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> = {};

  for (const eventName of options.events) {
    hooks[eventName] = [
      {
        hooks: [
          options.hookCommand
            ? {
                type: "command",
                command: options.hookCommand,
                ...(eventName === "Notification" ? { async: true } : {}),
              }
            : {
                type: "command",
                command: options.nodeCommand,
                args: [relayScriptPath, options.agent],
                ...(eventName === "Notification" ? { async: true } : {}),
              },
        ],
      },
    ];
  }

  return { hooks };
}

async function handleRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  runtime: AttentionRuntime,
  token: string,
): Promise<void> {
  if (!request.url) {
    response.writeHead(404);
    response.end();
    return;
  }

  if (request.url.startsWith(`/v1/webview/${token}/`)) {
    if (request.method === "OPTIONS") {
      response.writeHead(204, webviewCorsHeaders());
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === `/v1/webview/${token}/serve`) {
      await handleWebviewServe(response, runtime);
      return;
    }

    if (request.method === "GET" && request.url === `/v1/webview/${token}/ad`) {
      await handleWebviewAd(response, runtime);
      return;
    }

    if (request.method === "GET" && request.url.startsWith(`/v1/webview/${token}/open`)) {
      await handleWebviewOpen(request, response, runtime);
      return;
    }

    if (request.method === "POST") {
      await handleWebviewPing(request, response, runtime, token);
      return;
    }

    response.writeHead(404);
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(404);
    response.end();
    return;
  }

  const isTerminalRoute =
    request.url === "/v1/hooks/terminal" || request.url === "/v1/hooks/claude";

  if (!isTerminalRoute) {
    response.writeHead(404);
    response.end();
    return;
  }

  const authHeader = request.headers.authorization;
  if (authHeader !== `Bearer ${token}`) {
    response.writeHead(401);
    response.end();
    return;
  }

  try {
    const body = await readBody(request);
    const parsed = JSON.parse(body) as {
      occurred_at?: string;
      agent?: string;
      metadata?: Record<string, unknown>;
    };

    const agent = parseHookAgent(parsed.agent, request.url);
    const metadata = parsed.metadata ? extractTerminalHookMetadata(parsed.metadata) : null;
    if (!metadata || !agent) {
      response.writeHead(400);
      response.end();
      return;
    }

    const observation = mapTerminalHookToObservation(
      agent,
      metadata,
      parsed.occurred_at ?? new Date().toISOString(),
    );

    if (observation) {
      await reportTerminalActivity(runtime, observation);
      await updateTerminalDisplayState(runtime, observation.activity);
    }

    response.writeHead(202);
    response.end();
  } catch {
    response.writeHead(400);
    response.end();
  }
}

function parseHookAgent(agent: string | undefined, requestUrl: string | undefined): Agent | null {
  if (agent === "claude_code" || agent === "codex_cli") {
    return agent;
  }

  if (requestUrl === "/v1/hooks/claude" || requestUrl === "/v1/hooks/terminal") {
    return "claude_code";
  }

  return null;
}

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function handleWebviewServe(
  response: import("node:http").ServerResponse,
  runtime: AttentionRuntime,
): Promise<void> {
  const suppressed = await runtime.getDisplayLifecycleService().isUserSuppressed();
  // Only serve when there is actually an ad to show. With an empty cache (or a
  // version-blocked build that never registered), there is no allocation, so we report
  // serve:false and the webview overlay stays hidden — leaving the native Claude/Codex
  // "thinking" UI untouched instead of rendering an empty block.
  const allocation = suppressed ? undefined : await ensurePatchAllocation(runtime);
  response.writeHead(200, { "content-type": "application/json", ...webviewCorsHeaders() });
  response.end(JSON.stringify({ serve: !suppressed && allocation != null }));
}

async function handleWebviewAd(
  response: import("node:http").ServerResponse,
  runtime: AttentionRuntime,
): Promise<void> {
  const suppressed = await runtime.getDisplayLifecycleService().isUserSuppressed();
  const allocation = await ensurePatchAllocation(runtime);

  if (suppressed || !allocation) {
    response.writeHead(200, { "content-type": "application/json", ...webviewCorsHeaders() });
    response.end(JSON.stringify({ serve: false }));
    return;
  }

  const iconUrl = allocation.iconUrl
    ? ((await resolveCampaignIconDataUrl(allocation.iconUrl)) ?? "")
    : "";

  response.writeHead(200, { "content-type": "application/json", ...webviewCorsHeaders() });
  response.end(
    JSON.stringify({
      serve: true,
      allocation_id: allocation.allocationId,
      brand: allocation.brand,
      headline: allocation.headline,
      icon_url: iconUrl,
      click_url: allocation.destinationUrl,
    }),
  );
}

async function handleWebviewOpen(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  runtime: AttentionRuntime,
): Promise<void> {
  try {
    const parsed = new URL(request.url ?? "", "http://127.0.0.1");
    const allocationId = parsed.searchParams.get("allocation_id");
    if (!allocationId) {
      response.writeHead(400, webviewCorsHeaders());
      response.end();
      return;
    }

    const surface = normalizeRenderSurface(parsed.searchParams.get("surface") ?? undefined);
    if (surface) {
      // Record the click first, so it's attributed even if the open/redirect below fails.
      await runtime.getDisplayLifecycleService().recordClick(surface, allocationId);
    }

    const destination = await resolveAllocationDestination(runtime, allocationId);

    // A real browser navigation (terminal OSC-8 link, status-bar open, or a direct hit) gets a
    // 302 to the destination — one clean tab, click already recorded. The overlay block calls
    // this via fetch() (not a navigation), so for that path we open via the extension host.
    const isNavigation =
      request.headers["sec-fetch-mode"] === "navigate" ||
      (request.headers.accept ?? "").includes("text/html");
    if (destination && isNavigation) {
      response.writeHead(302, { ...webviewCorsHeaders(), Location: destination });
      response.end();
      return;
    }

    if (destination) {
      await openUrlInSystemBrowser(destination);
    }
    response.writeHead(204, webviewCorsHeaders());
    response.end();
  } catch {
    response.writeHead(500, webviewCorsHeaders());
    response.end();
  }
}

async function handleWebviewPing(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  runtime: AttentionRuntime,
  token: string,
): Promise<void> {
  const prefix = `/v1/webview/${token}/`;
  if (!request.url?.startsWith(prefix)) {
    response.writeHead(404);
    response.end();
    return;
  }

  const kind = request.url.slice(prefix.length).replace(/\/$/, "");
  if (kind !== "impression" && kind !== "click") {
    response.writeHead(404);
    response.end();
    return;
  }

  try {
    const body = await readBody(request);
    const parsed = JSON.parse(body) as {
      allocation_id?: string;
      surface?: string;
      visible_ms?: number;
    };
    const allocationId = parsed.allocation_id;
    const surface = normalizeRenderSurface(parsed.surface);
    if (!allocationId || !surface) {
      response.writeHead(400);
      response.end();
      return;
    }

    const lifecycle = runtime.getDisplayLifecycleService();
    if (kind === "impression") {
      if (parsed.visible_ms !== undefined) {
        await lifecycle.reportSurfaceVisibility(surface, allocationId, parsed.visible_ms);
      }
    } else {
      void openAdDestination(runtime, allocationId);
    }

    response.writeHead(202, webviewCorsHeaders());
    response.end();
  } catch {
    response.writeHead(400, webviewCorsHeaders());
    response.end();
  }
}

function normalizeRenderSurface(value: string | undefined): RenderSurface | undefined {
  if (value === "overlay") {
    return "claude_overlay";
  }

  if (
    value === "claude_overlay" ||
    value === "codex_overlay" ||
    value === "cli_spinner_verb" ||
    value === "cli_status_line" ||
    value === "codex_cli_banner" ||
    value === "vscode_status_bar"
  ) {
    return value;
  }

  return undefined;
}

async function resolveAllocationDestination(
  runtime: AttentionRuntime,
  allocationId: string,
): Promise<string | undefined> {
  const current = runtime.getDisplayLifecycleService().getCurrentAllocation();
  if (current?.allocationId === allocationId) {
    return current.destinationUrl;
  }

  // Resolve from the cache regardless of state (TD-028): a click can land after the ad was
  // consumed/expired, and we still want the redirect to work.
  const entry = await runtime.getCacheStore().getEntry<CachedAllocation>(allocationId);
  return entry?.value.destinationUrl;
}

async function openAdDestination(runtime: AttentionRuntime, allocationId: string): Promise<void> {
  const destination = await resolveAllocationDestination(runtime, allocationId);
  if (!destination) {
    return;
  }

  await openUrlInSystemBrowser(destination);
}

function webviewCorsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

async function updateTerminalDisplayState(
  runtime: AttentionRuntime,
  activity: string | undefined,
): Promise<void> {
  if (!activity) {
    return;
  }

  if (activity === "waiting_started") {
    await syncDisplaySurfacesFromRuntime(runtime);
    return;
  }

  if (activity === "waiting_ended" || activity === "session_completed") {
    await syncDisplaySurfacesFromRuntime(runtime);
  }
}

function hookEndpointConfigPath(): string {
  return path.join(os.homedir(), ".runtimeads", "claude-hook-endpoint.json");
}

/** Reads the persisted loopback identity (token + port) so it can be reused across restarts. */
async function readHookEndpointConfig(): Promise<{ token: string; port: number } | null> {
  try {
    const raw = await readFile(hookEndpointConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown; port?: unknown; url?: unknown };
    const token = typeof parsed.token === "string" && parsed.token ? parsed.token : null;
    let port = typeof parsed.port === "number" ? parsed.port : null;
    if (port === null && typeof parsed.url === "string") {
      const parsedPort = Number(new URL(parsed.url).port);
      port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : null;
    }
    return token && port ? { token, port } : null;
  } catch {
    return null;
  }
}

/** Bind the preferred (persisted) port; fall back to an OS-assigned ephemeral port if taken. */
async function listenWithFallback(
  server: ReturnType<typeof createServer>,
  preferredPort?: number,
): Promise<void> {
  const tryListen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: unknown) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });

  if (preferredPort && preferredPort > 0) {
    try {
      await tryListen(preferredPort);
      return;
    } catch {
      // Persisted port is taken (e.g. another window) or invalid — use an ephemeral one.
    }
  }
  await tryListen(0);
}

async function writeHookEndpointConfig(endpoint: {
  url: string;
  token: string;
  port: number;
}): Promise<void> {
  const configDir = path.join(os.homedir(), ".runtimeads");
  await mkdir(configDir, { recursive: true });

  const payload = JSON.stringify(endpoint, null, 2);
  await writeFile(path.join(configDir, "terminal-hook-endpoint.json"), payload, "utf8");
  await writeFile(path.join(configDir, "claude-hook-endpoint.json"), payload, "utf8");
}
