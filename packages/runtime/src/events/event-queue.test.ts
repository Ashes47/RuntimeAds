import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "../storage/key-value-store";
import { EventQueue } from "./event-queue";

describe("EventQueue", () => {
  it("persists queued events through the key-value store", async () => {
    const store = new MemoryKeyValueStore();
    const firstQueue = new EventQueue(store);

    await firstQueue.enqueue(makeEvent("event-1"));

    const secondQueue = new EventQueue(store);
    await secondQueue.start();

    expect(secondQueue.size()).toBe(1);
    expect((await secondQueue.listUploadable()).map((record) => record.id)).toEqual(["event-1"]);
  });

  it("does not count completed events as pending queue size", async () => {
    const queue = new EventQueue(new MemoryKeyValueStore());

    await queue.enqueue(makeEvent("event-1"));
    await queue.markCompleted(["event-1"]);

    expect(queue.size()).toBe(0);
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
