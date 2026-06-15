import { afterEach, describe, expect, it, vi } from "vitest";

import { EventQueue } from "../events/event-queue";
import type { QueuedEvent } from "../events/event-queue";
import { MemoryKeyValueStore } from "../storage/key-value-store";
import { SyncEngine } from "./sync-engine";

describe("SyncEngine", () => {
  it("uploads queued events and marks them completed", async () => {
    const queue = new EventQueue(new MemoryKeyValueStore());
    const uploaded: QueuedEvent[][] = [];
    const sync = new SyncEngine({
      eventQueue: queue,
      uploadClient: {
        async uploadEvents(events) {
          uploaded.push(events);
        },
      },
    });

    await queue.enqueue(makeEvent("event-1"));
    await sync.flush();

    expect(uploaded).toHaveLength(1);
    expect(queue.size()).toBe(0);
    expect(sync.getLastSyncAt()).toBeDefined();
  });

  it("runs beforeFlush before uploading events", async () => {
    const queue = new EventQueue(new MemoryKeyValueStore());
    let beforeFlushCount = 0;
    const sync = new SyncEngine({
      eventQueue: queue,
      beforeFlush: async () => {
        beforeFlushCount += 1;
      },
      uploadClient: {
        async uploadEvents() {
          return;
        },
      },
    });

    await queue.enqueue(makeEvent("event-1"));
    await sync.flush();

    expect(beforeFlushCount).toBe(1);
  });

  it("marks events failed when upload fails", async () => {
    const queue = new EventQueue(new MemoryKeyValueStore());
    const sync = new SyncEngine({
      eventQueue: queue,
      uploadClient: {
        async uploadEvents() {
          throw new Error("backend down");
        },
      },
    });

    await queue.enqueue(makeEvent("event-1"));

    await expect(sync.flush()).rejects.toThrow("backend down");

    const uploadable = await queue.listUploadable();
    expect(uploadable).toMatchObject([
      {
        id: "event-1",
        state: "failed",
        attempts: 1,
        lastError: "backend down",
      },
    ]);
  });

  it("applies exponential backoff after upload failures", async () => {
    vi.useFakeTimers();
    const queue = new EventQueue(new MemoryKeyValueStore());
    const sync = new SyncEngine({
      eventQueue: queue,
      intervalMs: 1_000,
      maxBackoffMs: 8_000,
      uploadClient: {
        async uploadEvents() {
          throw new Error("backend down");
        },
      },
      scheduler: {
        setInterval() {
          return undefined;
        },
        clearInterval() {
          return;
        },
      },
    });

    await queue.enqueue(makeEvent("event-1"));

    const first = expect(sync.flush()).rejects.toThrow("backend down");
    await vi.runAllTimersAsync();
    await first;

    const second = expect(sync.flush()).rejects.toThrow("backend down");
    await vi.advanceTimersByTimeAsync(1_000);
    await second;

    const third = expect(sync.flush()).rejects.toThrow("backend down");
    await vi.advanceTimersByTimeAsync(2_000);
    await third;

    expect(sync.getSyncStatus()).toBe("error");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and stops its scheduled flush loop", async () => {
    const handles: unknown[] = [];
    const cleared: unknown[] = [];
    const sync = new SyncEngine({
      eventQueue: new EventQueue(new MemoryKeyValueStore()),
      scheduler: {
        setInterval(handler, timeoutMs) {
          expect(timeoutMs).toBe(30_000);
          handles.push(handler);
          return handler;
        },
        clearInterval(handle) {
          cleared.push(handle);
        },
      },
    });

    await sync.start();
    await sync.stop();

    expect(handles).toHaveLength(1);
    expect(cleared).toEqual(handles);
  });
});

function makeEvent(eventId: string) {
  return {
    eventId,
    eventType: "runtime.started",
    eventVersion: 1,
    occurredAt: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T10:00:01.000Z",
    installId: "00000000-0000-4000-8000-000000000001",
    platform: "vscode" as const,
    sdkVersion: "0.1.0",
    payload: {},
  };
}
