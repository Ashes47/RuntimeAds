import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import { createRuntime } from "../index";

describe("DefaultAttentionRuntime", () => {
  it("starts with a stable install ID and reports runtime health", async () => {
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "install-1",
    });

    await runtime.start();

    expect(runtime.getStatus()).toMatchObject({
      health: "healthy",
      authStatus: "unauthenticated",
      installId: "install-1",
      cacheSize: 0,
      queueSize: 2,
    });
    expect(runtime.getStatus().startedAt).toBeDefined();
  });

  it("reports queued event count in runtime status", async () => {
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "install-1",
    });

    await runtime.start();
    await runtime.getEventQueue().enqueue({
      eventId: "event-1",
      eventType: "runtime.started",
      eventVersion: 1,
      occurredAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T10:00:01.000Z",
      installId: "00000000-0000-4000-8000-000000000001",
      platform: "vscode",
      sdkVersion: "0.1.0",
      payload: {},
    });

    expect(runtime.getStatus().queueSize).toBe(3);
  });

  it("records install telemetry only for newly provisioned installs", async () => {
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "install-1",
    });

    await runtime.start();

    expect(runtime.getStatus().queueSize).toBe(2);
    const eventTypes = (await runtime.getEventQueue().listUploadable(10)).map(
      (record) => record.event.eventType,
    );
    expect(eventTypes).toContain("runtime.installed");
    expect(eventTypes).toContain("runtime.started");
  });

  it("keeps operating offline when no upload client is configured", async () => {
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "install-offline",
    });

    await runtime.start();
    await runtime.getEventQueue().enqueue({
      eventId: "offline-event",
      eventType: "runtime.error",
      eventVersion: 1,
      occurredAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T10:00:01.000Z",
      installId: "install-offline",
      platform: "vscode",
      sdkVersion: "0.1.0",
      payload: { reason: "offline" },
    });

    expect(runtime.getStatus().health).toBe("healthy");
    expect(runtime.getStatus().queueSize).toBeGreaterThan(0);
    expect(runtime.getStatus().lastSyncAt).toBeUndefined();
  });

  it("registers install after authentication before syncing", async () => {
    const registrations: string[] = [];
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "00000000-0000-4000-8000-000000000001",
      registrationClient: {
        async registerInstall(request) {
          registrations.push(request.installId);
        },
      },
      eventUploadClient: {
        async uploadEvents() {
          return;
        },
      },
    });

    await runtime.start();
    expect(registrations).toHaveLength(0);

    await runtime.getAuthSessionManager().storeSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      developerId: "00000000-0000-4000-8000-000000000101",
    });
    await runtime.getSyncEngine().flush();

    expect(registrations.length).toBeGreaterThan(0);
    expect(
      registrations.every((installId) => installId === "00000000-0000-4000-8000-000000000001"),
    ).toBe(true);
  });

  it("queues display events offline without an upload client", async () => {
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "install-offline",
    });

    await runtime.start();
    await runtime.getCacheStore().put({
      id: "alloc-offline",
      value: {
        allocationId: "alloc-offline",
        campaignId: "campaign-offline",
        brand: "Offline Brand",
        iconUrl: "https://example.com/icon.png",
        headline: "Offline headline",
        destinationUrl: "https://example.com",
        cpmCents: 0,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });

    const lifecycle = runtime.getDisplayLifecycleService();
    const allocation = await lifecycle.beginWaitingSession("session-offline");
    expect(allocation?.allocationId).toBe("alloc-offline");

    await lifecycle.recordImpression("cli_spinner_verb", "alloc-offline", "session-offline", {
      visibleMs: 5000,
    });

    const eventTypes = (await runtime.getEventQueue().listUploadable()).map(
      (record) => record.event.eventType,
    );
    expect(eventTypes).toContain("inventory.displayed");
    expect(eventTypes).toContain("render.impression");
    expect(runtime.getStatus().display?.pendingRenderEvents).toBeGreaterThan(0);
    expect(runtime.getStatus().health).toBe("healthy");
  });

  it("records impressions when a Claude tool wait ends after UserPromptSubmit", async () => {
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "install-hook-tool",
    });

    await runtime.start();
    await runtime.getCacheStore().put({
      id: "alloc-hook-tool",
      value: {
        allocationId: "alloc-hook-tool",
        campaignId: "campaign-hook-tool",
        brand: "Hook Brand",
        iconUrl: "https://example.com/icon.png",
        headline: "Hook headline",
        destinationUrl: "https://example.com",
        cpmCents: 0,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });

    const agent = runtime.getAgentDetectionService();
    const sessionId = "session-hook-tool";

    await agent.ingest({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:00.000Z",
      sessionId,
      detectionMethod: "hook",
      waitingReason: "thinking",
    });
    await agent.ingest({
      agent: "claude_code",
      activity: "waiting_started",
      occurredAt: "2026-01-01T10:00:02.000Z",
      sessionId,
      detectionMethod: "hook",
      waitingReason: "tool_running",
    });
    await agent.ingest({
      agent: "claude_code",
      activity: "waiting_ended",
      occurredAt: "2026-01-01T10:00:10.000Z",
      sessionId,
      detectionMethod: "hook",
    });

    expect(runtime.getStatus().display?.impressions).toBe(1);
  });

  it("reports active cache count in runtime status", async () => {
    const runtime = createRuntime({
      platform: "vscode",
      secureStore: createSecureStore(),
      localStore: new MemoryKeyValueStore(),
      idFactory: () => "install-1",
    });

    await runtime.start();
    await runtime.getCacheStore().put({
      id: "cache-1",
      value: { kind: "runtime-config" },
    });

    expect(runtime.getStatus().cacheSize).toBe(1);
  });
});

function createSecureStore() {
  const values = new Map<string, string>();

  return {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
}
