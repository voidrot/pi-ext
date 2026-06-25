import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Migrator } from "kysely/migration";
import { openSqliteDatabase, type OpenedSqliteDatabase } from "./connection";
import { resolveGlobalDatabasePath, resolveProjectDatabasePath } from "./paths";
import type { DatabaseMigrationRegistry } from "./registry";

export interface DatabaseManagerOptions {
  agentDir: string;
  registry: DatabaseMigrationRegistry;
}

export interface PiExtDatabaseHandles {
  global: OpenedSqliteDatabase<"global">;
  project?: OpenedSqliteDatabase<"project">;
}

export class DatabaseManager {
  private handles: PiExtDatabaseHandles | undefined;
  private cacheKey: string | undefined;

  constructor(private readonly options: DatabaseManagerOptions) {}

  async ensureInitialized(ctx: ExtensionContext): Promise<PiExtDatabaseHandles> {
    const projectTrusted = typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
    const key = `${this.options.agentDir}\n${ctx.cwd}\n${projectTrusted}`;
    if (this.handles && this.cacheKey === key) return this.handles;

    await this.destroy();

    const global = openSqliteDatabase("global", resolveGlobalDatabasePath(this.options.agentDir));
    await this.migrate(global);

    const project = projectTrusted ? openSqliteDatabase("project", resolveProjectDatabasePath(ctx.cwd)) : undefined;
    if (project) await this.migrate(project);

    this.handles = { global, ...(project ? { project } : {}) };
    this.cacheKey = key;
    return this.handles;
  }

  async destroy(): Promise<void> {
    const current = this.handles;
    this.handles = undefined;
    this.cacheKey = undefined;
    await current?.project?.destroy();
    await current?.global.destroy();
  }

  private async migrate(handle: OpenedSqliteDatabase<any>): Promise<void> {
    const migrator = new Migrator({
      db: handle.db,
      provider: this.options.registry.createProvider(handle.scope),
      migrationTableName: "pi_ext_migration",
      migrationLockTableName: "pi_ext_migration_lock",
    });
    const { error } = await migrator.migrateToLatest();
    if (error) throw error;
  }
}
