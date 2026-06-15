import { describe, expect, it } from "vitest";

import { CacheStore } from "../../cache/cache-store";
import { EventQueue } from "../../events/event-queue";
import { MemoryKeyValueStore } from "../../storage/key-value-store";
import { CacheEntriesStore } from "../cache-entries-store";
import { LocalDatabase } from "../local-database";
import { PendingEventsStore } from "../pending-events-store";
import { RuntimeStateStore } from "../runtime-state-store";
import type { SqliteDatabase, SqliteStatement } from "../sqlite-key-value-store";
import { createFourTableSchemaMigration } from "./001-four-table-schema";

describe("four-table schema migration", () => {
  it("moves queue, cache, and install state into relational tables", async () => {
    const database = new InMemorySqliteDatabase();
    const settingsStore = new MemoryKeyValueStore();

    await settingsStore.set("runtimeads.event_queue.records", [
      {
        id: "event-1",
        event: {
          eventId: "event-1",
          eventType: "runtime.started",
          eventVersion: 1,
          occurredAt: "2026-01-01T10:00:00.000Z",
          createdAt: "2026-01-01T10:00:01.000Z",
          installId: "00000000-0000-4000-8000-000000000001",
          platform: "vscode",
          sdkVersion: "0.1.0",
          payload: {},
        },
        state: "pending",
        attempts: 0,
        createdAt: "2026-01-01T10:00:01.000Z",
        updatedAt: "2026-01-01T10:00:01.000Z",
      },
    ]);
    await settingsStore.set("runtimeads.cache.entries", [
      {
        id: "allocation-1",
        value: { brand: "Notion" },
        state: "active",
        createdAt: "2026-01-01T10:00:00.000Z",
      },
    ]);
    await settingsStore.set("runtimeads.install_id", "00000000-0000-4000-8000-000000000099");

    const migration = createFourTableSchemaMigration(database, settingsStore);
    const localDatabase = new LocalDatabase(
      settingsStore,
      [migration],
      new RuntimeStateStore(database),
    );

    await localDatabase.migrate();

    const queue = new EventQueue(settingsStore, new PendingEventsStore(database));
    await queue.start();
    expect(queue.size()).toBe(1);

    const cache = new CacheStore(settingsStore, new CacheEntriesStore(database));
    await cache.start();
    expect(cache.size()).toBe(1);

    const runtimeState = new RuntimeStateStore(database);
    expect(await runtimeState.get<string>("runtimeads.install_id")).toBe(
      "00000000-0000-4000-8000-000000000099",
    );
    expect(await settingsStore.get("runtimeads.event_queue.records")).toBeUndefined();
    expect(await settingsStore.get("runtimeads.cache.entries")).toBeUndefined();
    expect(await settingsStore.get("runtimeads.install_id")).toBeUndefined();
  });
});

class InMemorySqliteDatabase implements SqliteDatabase {
  private readonly tables = new Map<string, Map<string, Record<string, unknown>>>();

  exec(sql: string): void {
    if (sql.includes("DELETE FROM")) {
      const table = sql.match(/DELETE FROM (\w+)/)?.[1];
      if (table) {
        this.tables.set(table, new Map());
      }
    }
  }

  prepare(sql: string): SqliteStatement {
    const table = this.tableName(sql);

    return {
      get: <T>(...params: unknown[]) => {
        const rows = [...(this.tables.get(table)?.values() ?? [])];
        const row = rows.find((candidate) => this.matches(candidate, sql, params));
        return row as T | undefined;
      },
      all: <T>(...params: unknown[]) => {
        const rows = [...(this.tables.get(table)?.values() ?? [])];
        return rows.filter((candidate) => this.matches(candidate, sql, params)) as T[];
      },
      run: (...params: unknown[]) => {
        if (sql.includes("INSERT INTO")) {
          const key = String(params[0]);
          const tableRows = this.tables.get(table) ?? new Map();
          tableRows.set(key, {
            event_id: params[0],
            event_type: params[1],
            payload: params[2],
            status: params[3],
            retry_count: params[4],
            last_error: params[5],
            occurred_at: params[6],
            created_at: params[7],
            updated_at: params[8],
            id: params[0],
            value_json: params[1],
            state: params[2],
            expires_at: params[3],
            key: params[0],
            value: params[1],
          });
          this.tables.set(table, tableRows);
        }
      },
    };
  }

  private tableName(sql: string): string {
    const match = sql.match(/(?:FROM|INTO) (\w+)/);
    return match?.[1] ?? "unknown";
  }

  private matches(row: Record<string, unknown>, sql: string, params: unknown[]): boolean {
    if (sql.includes("WHERE key = ?")) {
      return row.key === params[0];
    }

    return true;
  }
}
