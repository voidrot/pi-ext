import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiExtDatabaseHandles } from "./database/manager";
import type { MigrationMap } from "./database/registry";
import type { DatabaseScope } from "./database/schema";
import type { PiExtRuntime, RuntimeReloadListener } from "./runtime";

export type ModuleId = "dcp" | "dashboard" | "agents";

export interface ModuleApi {
  pi: ExtensionAPI;
  getRuntime(ctx: ExtensionContext): PiExtRuntime;
  getDatabases(ctx: ExtensionContext): Promise<PiExtDatabaseHandles>;
  registerDatabaseMigrations(scope: DatabaseScope, moduleId: ModuleId | "core", migrations: MigrationMap): void;
  isEnabled(ctx: ExtensionContext, moduleId: ModuleId): boolean;
  onRuntimeReload(listener: RuntimeReloadListener): void;
}

export interface PiExtModule {
  id: ModuleId;
  label: string;
  register(api: ModuleApi): void;
}
