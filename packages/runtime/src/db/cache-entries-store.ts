import type { CacheEntry, CacheState } from "../cache/cache-store";
import type { SqliteDatabase } from "./sqlite-key-value-store";

interface CacheEntryRow {
  id: string;
  value_json: string;
  state: CacheState;
  expires_at: string | null;
  created_at: string;
}

export class CacheEntriesStore {
  constructor(private readonly database: SqliteDatabase) {}

  async listAll(): Promise<CacheEntry[]> {
    const rows = this.database
      .prepare(
        `
        SELECT id, value_json, state, expires_at, created_at
        FROM cache_entries
        ORDER BY created_at ASC
      `,
      )
      .all<CacheEntryRow>();

    return rows.map((row) => ({
      id: row.id,
      value: JSON.parse(row.value_json) as unknown,
      state: row.state,
      createdAt: row.created_at,
      ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    }));
  }

  async replaceAll(entries: CacheEntry[]): Promise<void> {
    this.database.exec("DELETE FROM cache_entries");

    const insert = this.database.prepare(`
      INSERT INTO cache_entries (id, value_json, state, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const entry of entries) {
      insert.run(
        entry.id,
        JSON.stringify(entry.value),
        entry.state,
        entry.expiresAt ?? null,
        entry.createdAt,
      );
    }
  }
}
