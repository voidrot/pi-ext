import type { Migration, MigrationProvider } from "kysely/migration";
import type { DatabaseScope } from "./schema";

export type MigrationMap = Record<string, Migration>;

export class DatabaseMigrationRegistry {
  private readonly migrations: Record<DatabaseScope, Map<string, Migration>> = {
    global: new Map(),
    project: new Map(),
  };

  register(scope: DatabaseScope, moduleId: string, migrations: MigrationMap): void {
    for (const [name, migration] of Object.entries(migrations)) {
      const fullName = `${moduleId}__${name}`;
      const scopedMigrations = this.migrations[scope];
      if (scopedMigrations.has(fullName)) {
        throw new Error(`Duplicate ${scope} migration ${fullName}`);
      }
      scopedMigrations.set(fullName, migration);
    }
  }

  createProvider(scope: DatabaseScope): MigrationProvider {
    return {
      getMigrations: async () => Object.fromEntries(
        [...this.migrations[scope].entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }
}
