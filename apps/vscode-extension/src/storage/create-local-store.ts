import path from "node:path";

import type { ExtensionContext, Memento } from "vscode";

import {
  SecureStoreIntegrityKeyProvider,
  SignedKeyValueStore,
  SqliteKeyValueStore,
  migrateLegacyLocalStore,
  type KeyValueStore,
} from "@runtimeads/runtime";

import { PersistingKeyValueStore } from "./persisting-key-value-store";
import { SqlJsDatabase } from "./sql-js-database";

const SQLITE_FILE_NAME = "runtimeads.sqlite";

export interface LocalStoreHandle {
  store: KeyValueStore;
  sqliteDatabase: SqlJsDatabase;
  dispose: () => Promise<void>;
}

export async function createLocalStore(context: ExtensionContext): Promise<LocalStoreHandle> {
  const dbPath = path.join(context.globalStorageUri.fsPath, SQLITE_FILE_NAME);
  const wasmPath = path.join(context.extensionPath, "dist", "sql-wasm.wasm");
  const database = await SqlJsDatabase.open(dbPath, wasmPath);
  const sqliteStore = new SqliteKeyValueStore(database);

  sqliteStore.initialize();

  const signedStore = new SignedKeyValueStore(
    sqliteStore,
    new SecureStoreIntegrityKeyProvider(context.secrets),
  );
  const store = new PersistingKeyValueStore(signedStore, () => database.persist());

  await migrateLegacyLocalStore(createMementoReader(context.globalState), store);

  return {
    store,
    sqliteDatabase: database,
    dispose: async () => {
      await database.persist();
      database.close();
    },
  };
}

function createMementoReader(memento: Memento) {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return memento.get<T>(key);
    },
    async delete(key: string): Promise<void> {
      await memento.update(key, undefined);
    },
  };
}
