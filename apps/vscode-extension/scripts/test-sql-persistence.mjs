import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import initSqlJs from "sql.js";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(extensionRoot, "dist", "sql-wasm.wasm");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "runtimeads-sqlite-"));
const dbPath = path.join(tempDir, "runtimeads.sqlite");

try {
  const sqlJs = await initSqlJs({ locateFile: () => wasmPath });
  const database = new sqlJs.Database();
  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const insert = database.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  insert.run(["runtime", JSON.stringify({ healthy: true }), new Date().toISOString()]);
  insert.free();

  const bytes = database.export();
  await writeFileAtomic(dbPath, bytes);
  database.close();

  const reopenedSqlJs = await initSqlJs({ locateFile: () => wasmPath });
  const reopened = new reopenedSqlJs.Database(await readFile(dbPath));
  const select = reopened.prepare("SELECT value FROM settings WHERE key = ?");
  select.bind(["runtime"]);
  assert.equal(select.step(), true);
  const row = select.getAsObject();
  assert.deepEqual(JSON.parse(row.value), { healthy: true });
  select.free();
  reopened.close();
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function writeFileAtomic(filePath, bytes) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, Buffer.from(bytes));
  await rename(tempPath, filePath);
}
