import type { RuntimeService } from "../runtime/service";
import type { KeyValueStore } from "../storage/key-value-store";
import type { RuntimeStateStore } from "./runtime-state-store";

const MIGRATION_VERSION_KEY = "runtimeads.local_db.migration_version";

export interface Migration {
  version: number;
  name: string;
  up(): Promise<void>;
}

export class LocalDatabase implements RuntimeService {
  readonly name = "local-database";

  constructor(
    private readonly store: KeyValueStore,
    private readonly migrations: Migration[] = [],
    private readonly runtimeState?: RuntimeStateStore,
  ) {}

  async start(): Promise<void> {
    await this.migrate();
  }

  async migrate(): Promise<void> {
    const currentVersion =
      (await this.runtimeState?.get<number>(MIGRATION_VERSION_KEY)) ??
      (await this.store.get<number>(MIGRATION_VERSION_KEY)) ??
      0;
    const pending = [...this.migrations]
      .filter((migration) => migration.version > currentVersion)
      .sort((left, right) => left.version - right.version);

    for (const migration of pending) {
      await migration.up();
      if (this.runtimeState) {
        await this.runtimeState.set(MIGRATION_VERSION_KEY, migration.version);
      } else {
        await this.store.set(MIGRATION_VERSION_KEY, migration.version);
      }
    }
  }
}
