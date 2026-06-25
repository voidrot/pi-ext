import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerPiExtCommands } from "./core/commands";
import { ensureGlobalPiExtConfig } from "./core/config";
import { registerCoreDatabaseMigrations } from "./core/database/core-models";
import { DatabaseManager } from "./core/database/manager";
import { DatabaseMigrationRegistry, type MigrationMap } from "./core/database/registry";
import type { DatabaseScope } from "./core/database/schema";
import type { ModuleId } from "./core/modules";
import { createRuntimeManager } from "./core/runtime";
import { dcpModule } from "./modules/dcp";

export default function piExt(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  ensureGlobalPiExtConfig(agentDir);

  const runtime = createRuntimeManager(pi, { agentDir });
  const migrationRegistry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(migrationRegistry);
  const databaseManager = new DatabaseManager({ agentDir, registry: migrationRegistry });

  const moduleApi = {
    pi,
    getRuntime: runtime.load,
    getDatabases: (ctx: ExtensionContext) => databaseManager.ensureInitialized(ctx),
    registerDatabaseMigrations(scope: DatabaseScope, moduleId: ModuleId | "core", migrations: MigrationMap): void {
      migrationRegistry.register(scope, moduleId, migrations);
    },
    isEnabled(ctx: ExtensionContext, moduleId: ModuleId): boolean {
      const config = runtime.load(ctx).config;
      return config.enabled && config.modules[moduleId].enabled;
    },
    onRuntimeReload: runtime.onReload,
  };

  registerPiExtCommands(pi, runtime);
  dcpModule.register(moduleApi);

  pi.on("session_start", async (_event, ctx) => {
    runtime.reload(ctx);
    await databaseManager.ensureInitialized(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    runtime.reload(ctx);
    await databaseManager.ensureInitialized(ctx);
  });

  pi.on("session_shutdown", async () => {
    await databaseManager.destroy();
  });
}

export type PiExtExtensionContext = ExtensionContext;
