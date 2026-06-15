import type { EventEnvelope } from "@runtimeads/sdk-contracts";

import type { PendingEventsStore } from "../db/pending-events-store";
import type { KeyValueStore } from "../storage/key-value-store";

const QUEUE_KEY = "runtimeads.event_queue.records";

export type QueueState = "pending" | "processing" | "failed" | "completed";

export interface QueuedEvent {
  id: string;
  event: EventEnvelope;
  state: QueueState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export class EventQueue {
  private records: QueuedEvent[] = [];
  private loaded = false;

  constructor(
    private readonly store: KeyValueStore,
    private readonly pendingEvents?: PendingEventsStore,
  ) {}

  async start(): Promise<void> {
    await this.load();
  }

  async enqueue(event: EventEnvelope): Promise<QueuedEvent> {
    await this.load();

    const now = new Date().toISOString();
    const record: QueuedEvent = {
      id: event.eventId,
      event,
      state: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.records.push(record);
    await this.persist();
    return record;
  }

  async listUploadable(limit = 100): Promise<QueuedEvent[]> {
    await this.load();
    return this.records
      .filter((record) => record.state === "pending" || record.state === "failed")
      .slice(0, limit);
  }

  async markProcessing(ids: string[]): Promise<void> {
    await this.updateRecords(ids, (record) => ({
      ...record,
      state: "processing",
      attempts: record.attempts + 1,
    }));
  }

  async markCompleted(ids: string[]): Promise<void> {
    await this.updateRecords(ids, (record) => ({
      ...record,
      state: "completed",
    }));
  }

  async markFailed(ids: string[], error: string): Promise<void> {
    await this.updateRecords(ids, (record) => ({
      ...record,
      state: "failed",
      lastError: error,
    }));
  }

  size(): number {
    return this.records.filter((record) => record.state !== "completed").length;
  }

  countUploadableByEventType(predicate: (eventType: string) => boolean): number {
    return this.records.filter(
      (record) =>
        (record.state === "pending" || record.state === "failed") &&
        predicate(record.event.eventType),
    ).length;
  }

  private async updateRecords(
    ids: string[],
    updater: (record: QueuedEvent) => QueuedEvent,
  ): Promise<void> {
    await this.load();
    const idSet = new Set(ids);
    const updatedAt = new Date().toISOString();

    this.records = this.records.map((record) =>
      idSet.has(record.id) ? { ...updater(record), updatedAt } : record,
    );

    await this.persist();
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    if (this.pendingEvents) {
      this.records = await this.pendingEvents.listAll();
    } else {
      this.records = (await this.store.get<QueuedEvent[]>(QUEUE_KEY)) ?? [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (this.pendingEvents) {
      await this.pendingEvents.replaceAll(this.records);
      return;
    }

    await this.store.set(QUEUE_KEY, this.records);
  }
}
