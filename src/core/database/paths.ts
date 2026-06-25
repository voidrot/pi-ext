import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export const PI_EXT_DATABASE_FILE = "pi-ext.db";

export function resolveGlobalDatabasePath(agentDir: string): string {
  return join(dirname(agentDir), PI_EXT_DATABASE_FILE);
}

export function resolveProjectDatabasePath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, PI_EXT_DATABASE_FILE);
}

export function ensureDatabaseDirectory(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
}
