import { describe, expect, it } from "vitest";

import { RuntimeApiClient } from "./runtime-api-client";

describe("RuntimeApiClient", () => {
  it("adds bearer token to authenticated requests", async () => {
    const headers: string[] = [];
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      accessTokenProvider: async () => "access-token",
      fetcher: async (_url, init) => {
        headers.push(new Headers(init?.headers).get("authorization") ?? "");
        return jsonResponse({ success: true });
      },
    });

    await client.heartbeat({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      cacheSize: 0,
      queueSize: 0,
      online: true,
    });

    expect(headers).toEqual(["Bearer access-token"]);
  });

  it("forwards the host timezone on register and heartbeat (P1-20)", async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      fetcher: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ success: true });
      },
    });

    await client.registerInstall({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      timezone: "America/New_York",
    });
    await client.heartbeat({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      cacheSize: 0,
      queueSize: 0,
      online: true,
      timezone: "America/New_York",
    });

    expect(bodies[0]?.timezone).toBe("America/New_York");
    expect(bodies[1]?.timezone).toBe("America/New_York");
  });

  it("omits timezone when the host does not provide one", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      fetcher: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ success: true });
      },
    });

    await client.registerInstall({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
    });

    expect(body && "timezone" in body).toBe(false);
  });

  it("serializes hook integrity telemetry to snake_case", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      fetcher: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ success: true });
      },
    });

    await client.heartbeat({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      cacheSize: 0,
      queueSize: 0,
      online: true,
      hookIntegrity: {
        ok: false,
        mismatchedFiles: [".claude/runtimeads-terminal-hook.mjs"],
        fileHashes: { ".claude/runtimeads-terminal-hook.mjs": "deadbeef" },
        manifestMtime: "2026-06-13T04:00:00.000Z",
      },
    });

    expect(body?.hook_integrity).toEqual({
      ok: false,
      mismatched_files: [".claude/runtimeads-terminal-hook.mjs"],
      file_hashes: { ".claude/runtimeads-terminal-hook.mjs": "deadbeef" },
      manifest_mtime: "2026-06-13T04:00:00.000Z",
    });
  });

  it("omits hook integrity telemetry fields when absent", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      fetcher: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ success: true });
      },
    });

    await client.heartbeat({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      cacheSize: 0,
      queueSize: 0,
      online: true,
      hookIntegrity: {
        ok: true,
        mismatchedFiles: [],
      },
    });

    expect(body?.hook_integrity).toEqual({
      ok: true,
      mismatched_files: [],
    });
  });

  it("refreshes once on unauthorized responses", async () => {
    const headers: string[] = [];
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      accessTokenProvider: async () => "expired-token",
      refreshAccessToken: async () => "fresh-token",
      fetcher: async (_url, init) => {
        headers.push(new Headers(init?.headers).get("authorization") ?? "");
        if (headers.length === 1) {
          return new Response(null, { status: 401 });
        }

        return jsonResponse({ success: true });
      },
    });

    await client.heartbeat({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      cacheSize: 0,
      queueSize: 0,
      online: true,
    });

    expect(headers).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
  });

  it("fires onAccountBanned and throws (no retry) on 403 account_banned", async () => {
    let banned = 0;
    let calls = 0;
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      accessTokenProvider: async () => "access-token",
      onAccountBanned: () => {
        banned += 1;
      },
      fetcher: async () => {
        calls += 1;
        return new Response(JSON.stringify({ detail: "account_banned" }), { status: 403 });
      },
    });

    await expect(
      client.heartbeat({
        installId: "install-1",
        platform: "vscode",
        sdkVersion: "0.1.0",
        cacheSize: 0,
        queueSize: 0,
        online: true,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(banned).toBe(1);
    expect(calls).toBe(1); // terminal — never retried
  });

  it("routes agent signals and operational events to separate batch endpoints", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      fetcher: async (url, init) => {
        requests.push({
          path: new URL(String(url)).pathname,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return jsonResponse({ accepted: [], rejected: [] });
      },
    });

    await client.uploadEvents([
      makeQueuedEvent("event-1", "runtime.started"),
      makeQueuedEvent("event-2", "agent.waiting_started"),
    ]);

    expect(requests.map((request) => request.path)).toEqual([
      "/v1/signals/batch",
      "/v1/events/batch",
    ]);
    expect((requests[0]?.body.events as Array<{ event_type: string }>)[0]?.event_type).toBe(
      "agent.waiting_started",
    );
    expect((requests[1]?.body.events as Array<{ event_type: string }>)[0]?.event_type).toBe(
      "runtime.started",
    );
  });

  it("uploads inventory and render events to the operational batch endpoint", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      fetcher: async (url, init) => {
        requests.push({
          path: new URL(String(url)).pathname,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return jsonResponse({ accepted: [], rejected: [] });
      },
    });

    await client.uploadEvents([
      makeQueuedEvent("event-1", "inventory.displayed", {
        allocation_id: "00000000-0000-4000-8000-000000000020",
        campaign_id: "00000000-0000-4000-8000-000000000021",
        surface: "claude_overlay",
        rendered_at: "2026-01-01T10:00:05.000Z",
      }),
      makeQueuedEvent("event-2", "render.impression", {
        allocation_id: "00000000-0000-4000-8000-000000000020",
        surface: "claude_overlay",
      }),
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/v1/events/batch");
    const eventTypes = (requests[0]?.body.events as Array<{ event_type: string }>).map(
      (event) => event.event_type,
    );
    expect(eventTypes).toEqual(["inventory.displayed", "render.impression"]);
  });

  it("maps cpm_cents on refilled allocations, defaulting missing values to 0", async () => {
    const client = new RuntimeApiClient({
      baseUrl: "http://api.test",
      fetcher: async () =>
        jsonResponse({
          batch_id: "00000000-0000-4000-8000-000000000030",
          lease_expires_at: "2026-01-01T10:30:00.000Z",
          allocations: [
            {
              allocation_id: "00000000-0000-4000-8000-000000000031",
              campaign_id: "00000000-0000-4000-8000-000000000032",
              brand: "Linear",
              icon_url: "https://linear.app/favicon.ico",
              headline: "Built for speed",
              destination_url: "https://linear.app",
              cpm_cents: 750,
              expires_at: "2026-01-01T10:30:00.000Z",
            },
            {
              allocation_id: "00000000-0000-4000-8000-000000000033",
              campaign_id: "00000000-0000-4000-8000-000000000034",
              brand: "Ramp",
              icon_url: "https://ramp.com/favicon.ico",
              headline: "Corporate cards",
              destination_url: "https://ramp.com",
              expires_at: "2026-01-01T10:30:00.000Z",
            },
          ],
        }),
    });

    const result = await client.refillInventory({
      installId: "install-1",
      platform: "vscode",
      sdkVersion: "0.1.0",
      cacheRemaining: 0,
    });

    expect(result.allocations.map((allocation) => allocation.cpmCents)).toEqual([750, 0]);
  });
});

function makeQueuedEvent(id: string, eventType: string, payload: Record<string, unknown> = {}) {
  return {
    id,
    event: {
      eventId: id,
      eventType,
      eventVersion: 1,
      occurredAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T10:00:01.000Z",
      installId: "00000000-0000-4000-8000-000000000001",
      platform: "vscode" as const,
      sdkVersion: "0.1.0",
      payload,
    },
    state: "pending" as const,
    attempts: 0,
    createdAt: "2026-01-01T10:00:01.000Z",
    updatedAt: "2026-01-01T10:00:01.000Z",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
