import { describe, expect, it } from "vitest";

import { CacheStore } from "../cache/cache-store";
import { EventQueue } from "../events/event-queue";
import { InstallManager } from "../install/install-manager";
import { MemoryKeyValueStore } from "../storage/key-value-store";
import { HeartbeatService } from "./heartbeat-service";
import type { HeartbeatRequest } from "./heartbeat-service";

describe("HeartbeatService", () => {
  it("sends runtime health counts", async () => {
    const store = new MemoryKeyValueStore();
    const cacheStore = new CacheStore(store);
    const eventQueue = new EventQueue(store);
    const requests: HeartbeatRequest[] = [];

    const service = new HeartbeatService({
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      eventQueue,
      cacheStore,
      platform: "vscode",
      sdkVersion: "0.1.0",
      client: {
        async heartbeat(request) {
          requests.push(request);
        },
      },
    });

    await eventQueue.enqueue({
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
    await cacheStore.put({ id: "cache-1", value: { kind: "config" } });
    await service.send();

    expect(requests).toEqual([
      {
        installId: "install-1",
        platform: "vscode",
        sdkVersion: "0.1.0",
        cacheSize: 1,
        queueSize: 1,
        online: true,
      },
    ]);
    expect(service.getLastHeartbeatAt()).toBeDefined();
  });

  it("starts and stops its scheduled heartbeat loop", async () => {
    const store = new MemoryKeyValueStore();
    const handles: unknown[] = [];
    const cleared: unknown[] = [];
    const service = new HeartbeatService({
      installManager: new InstallManager({
        platform: "vscode",
        sdkVersion: "0.1.0",
        store,
        idFactory: () => "install-1",
      }),
      eventQueue: new EventQueue(store),
      cacheStore: new CacheStore(store),
      platform: "vscode",
      sdkVersion: "0.1.0",
      scheduler: {
        setInterval(handler, timeoutMs) {
          expect(timeoutMs).toBe(15 * 60_000);
          handles.push(handler);
          return handler;
        },
        clearInterval(handle) {
          cleared.push(handle);
        },
      },
    });

    await service.start();
    await service.stop();

    expect(handles).toHaveLength(1);
    expect(cleared).toEqual(handles);
  });
});
