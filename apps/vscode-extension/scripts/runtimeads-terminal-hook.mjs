import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

try {
  await runHook();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown hook error";
  console.error(`RuntimeAds hook failed: ${message}`);
}

process.exit(0);

async function runHook() {
  const endpoint = await resolveHookEndpoint();
  if (!endpoint) {
    return;
  }

  const input = await readStdin();
  if (!input.trim()) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    console.error("RuntimeAds hook received invalid JSON on stdin");
    return;
  }

  if (typeof payload.hook_event_name !== "string" || typeof payload.session_id !== "string") {
    return;
  }

  const metadata = {
    hook_event_name: payload.hook_event_name,
    session_id: payload.session_id,
  };

  if (typeof payload.source === "string") {
    metadata.source = payload.source;
  }

  if (typeof payload.tool_name === "string") {
    metadata.tool_name = payload.tool_name;
  }

  const agent = resolveAgent();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.token}`,
      },
      body: JSON.stringify({
        occurred_at: new Date().toISOString(),
        agent,
        metadata,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`RuntimeAds hook relay failed: ${response.status}`);
    }
  } catch {
    console.error("RuntimeAds hook relay unreachable; is the RuntimeAds extension running?");
  }
}

function resolveAgent() {
  const argvAgent = process.argv[2];
  if (argvAgent === "claude_code" || argvAgent === "codex_cli") {
    return argvAgent;
  }

  if (
    process.env.RUNTIMEADS_HOOK_AGENT === "claude_code" ||
    process.env.RUNTIMEADS_HOOK_AGENT === "codex_cli"
  ) {
    return process.env.RUNTIMEADS_HOOK_AGENT;
  }

  return "claude_code";
}

async function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text.startsWith("{") && text.endsWith("}")) {
        finish();
      }
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    process.stdin.resume();
    setTimeout(finish, 250);
  });
}

async function resolveHookEndpoint() {
  const configDir = path.join(os.homedir(), ".runtimeads");
  const configPaths = [
    path.join(configDir, "terminal-hook-endpoint.json"),
    path.join(configDir, "claude-hook-endpoint.json"),
  ];

  for (const configPath of configPaths) {
    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.url === "string" && typeof parsed.token === "string") {
        return parsed;
      }
    } catch {
      // Try the next endpoint file.
    }
  }

  if (process.env.RUNTIMEADS_HOOK_URL && process.env.RUNTIMEADS_HOOK_TOKEN) {
    return {
      url: process.env.RUNTIMEADS_HOOK_URL,
      token: process.env.RUNTIMEADS_HOOK_TOKEN,
    };
  }

  return undefined;
}
