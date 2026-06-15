import type { SqliteDatabase } from "./sqlite-key-value-store";

export class RuntimeStateStore {
  constructor(private readonly database: SqliteDatabase) {}

  async get<T>(key: string): Promise<T | undefined> {
    const row = this.database
      .prepare("SELECT value FROM runtime_state WHERE key = ?")
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
        INSERT INTO runtime_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  async delete(key: string): Promise<void> {
    this.database.prepare("DELETE FROM runtime_state WHERE key = ?").run(key);
  }
}
