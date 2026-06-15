import { describe, expect, it } from "vitest";

import { SqliteKeyValueStore } from "./sqlite-key-value-store";
import type { SqliteDatabase, SqliteStatement } from "./sqlite-key-value-store";

describe("SqliteKeyValueStore", () => {
  it("reads and writes JSON values through a SQLite-shaped adapter", async () => {
    const database = new FakeSqliteDatabase();
    const store = new SqliteKeyValueStore(database);

    store.initialize();
    await store.set("runtime", { healthy: true });

    expect(await store.get("runtime")).toEqual({ healthy: true });

    await store.delete("runtime");

    expect(await store.get("runtime")).toBeUndefined();
    expect(database.initialized).toBe(true);
  });
});

class FakeSqliteDatabase implements SqliteDatabase {
  readonly values = new Map<string, string>();
  initialized = false;

  exec(_sql: string): void {
    this.initialized = true;
  }

  prepare(sql: string): SqliteStatement {
    return {
      get: <T>(key: string) => {
        const value = this.values.get(key);
        return value ? ({ value } as T) : undefined;
      },
      all: () => [],
      run: (key: string, value?: string) => {
        if (sql.includes("DELETE")) {
          this.values.delete(key);
          return;
        }

        if (value) {
          this.values.set(key, value);
        }
      },
    };
  }
}
