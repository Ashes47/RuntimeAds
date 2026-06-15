import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import initSqlJs, { type Database, type SqlValue } from "sql.js";

import type { SqliteDatabase, SqliteStatement } from "@runtimeads/runtime";

export class SqlJsDatabase implements SqliteDatabase {
  // Serializes persist() so two snapshots never race on the temp file.
  private persistChain: Promise<void> = Promise.resolve();
  private persistCounter = 0;

  private constructor(
    private readonly database: Database,
    private readonly filePath: string,
  ) {}

  static async open(filePath: string, wasmPath: string): Promise<SqlJsDatabase> {
    await mkdir(path.dirname(filePath), { recursive: true });

    const sqlJs = await initSqlJs({
      locateFile: () => wasmPath,
    });

    let database: Database;
    try {
      const bytes = await readFile(filePath);
      database = new sqlJs.Database(bytes);
    } catch {
      database = new sqlJs.Database();
    }

    return new SqlJsDatabase(database, filePath);
  }

  exec(sql: string): void {
    this.database.run(sql);
  }

  prepare(sql: string): SqliteStatement {
    const statement = this.database.prepare(sql);

    return {
      get: <T = unknown>(...params: unknown[]) => {
        statement.bind(params as SqlValue[]);
        const hasRow = statement.step();
        if (!hasRow) {
          statement.reset();
          return undefined;
        }

        const row = statement.getAsObject() as T;
        statement.reset();
        return row;
      },
      all: <T = unknown>(...params: unknown[]) => {
        statement.bind(params as SqlValue[]);
        const rows: T[] = [];
        while (statement.step()) {
          rows.push(statement.getAsObject() as T);
        }
        statement.reset();
        return rows;
      },
      run: (...params: unknown[]) => {
        statement.bind(params as SqlValue[]);
        while (statement.step()) {
          // Drain result rows for statements that return data.
        }
        statement.reset();
      },
    };
  }

  async persist(): Promise<void> {
    // Run snapshots one at a time. Concurrent persists with a shared temp name caused
    // intermittent `ENOENT: rename <db>.tmp -> <db>` (the first rename consumed the temp before
    // the second's rename ran). Chaining serializes them; `.catch` keeps the chain alive after a
    // failure so later persists still run.
    const run = this.persistChain.then(() => this.writeSnapshot());
    this.persistChain = run.catch(() => undefined);
    return run;
  }

  private async writeSnapshot(): Promise<void> {
    const bytes = this.database.export();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    // Unique temp per write so even an unexpected overlap can't collide on the same temp file.
    const tempPath = `${this.filePath}.${process.pid}.${this.persistCounter++}.tmp`;
    await writeFile(tempPath, Buffer.from(bytes));
    await rename(tempPath, this.filePath);
  }

  close(): void {
    this.database.close();
  }
}
