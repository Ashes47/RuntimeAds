import type { KeyValueStore } from "../storage/key-value-store";
import { initializeLocalSchema } from "./schema";

export interface SqliteStatement {
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
  run(...params: unknown[]): void;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

export class SqliteKeyValueStore implements KeyValueStore {
  constructor(private readonly database: SqliteDatabase) {}

  initialize(): void {
    initializeLocalSchema(this.database);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const row = this.database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get<{ value: string }>(key);

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.value) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.database
      .prepare(
        `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  async delete(key: string): Promise<void> {
    this.database.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
}
