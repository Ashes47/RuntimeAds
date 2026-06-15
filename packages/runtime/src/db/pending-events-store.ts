import type { EventEnvelope } from "@runtimeads/sdk-contracts";

import type { QueuedEvent, QueueState } from "../events/event-queue";
import type { SqliteDatabase } from "./sqlite-key-value-store";

interface PendingEventRow {
  event_id: string;
  event_type: string;
  payload: string;
  status: QueueState;
  retry_count: number;
  last_error: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

export class PendingEventsStore {
  constructor(private readonly database: SqliteDatabase) {}

  async listAll(): Promise<QueuedEvent[]> {
    const rows = this.database
      .prepare(
        `
        SELECT event_id, event_type, payload, status, retry_count, last_error,
               occurred_at, created_at, updated_at
        FROM pending_events
        ORDER BY created_at ASC
      `,
      )
      .all<PendingEventRow>();

    return rows.map((row) => this.toQueuedEvent(row));
  }

  async replaceAll(records: QueuedEvent[]): Promise<void> {
    this.database.exec("DELETE FROM pending_events");

    const insert = this.database.prepare(`
      INSERT INTO pending_events (
        event_id, event_type, payload, status, retry_count, last_error,
        occurred_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of records) {
      insert.run(
        record.id,
        record.event.eventType,
        JSON.stringify(record.event),
        record.state,
        record.attempts,
        record.lastError ?? null,
        record.event.occurredAt,
        record.createdAt,
        record.updatedAt,
      );
    }
  }

  private toQueuedEvent(row: PendingEventRow): QueuedEvent {
    const event = JSON.parse(row.payload) as EventEnvelope;
    return {
      id: row.event_id,
      event,
      state: row.status,
      attempts: row.retry_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.last_error ? { lastError: row.last_error } : {}),
    };
  }
}
