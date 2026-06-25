import type { Generated, Kysely } from "kysely";
import { sql } from "kysely";
import type { DatabaseMigrationRegistry } from "./registry";
import { defineTableModel } from "./schema";

export interface CoreMetadataTable {
  key: string;
  value: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

declare module "./schema" {
  interface GlobalDatabase {
    pi_ext_metadata: CoreMetadataTable;
  }

  interface ProjectDatabase {
    pi_ext_project_metadata: CoreMetadataTable;
  }
}

export const globalCoreMetadataModel = defineTableModel({ scope: "global", tableName: "pi_ext_metadata" });
export const projectCoreMetadataModel = defineTableModel({ scope: "project", tableName: "pi_ext_project_metadata" });

export function registerCoreDatabaseMigrations(registry: DatabaseMigrationRegistry): void {
  registry.register("global", "core", {
    "0001_create_metadata": {
      up: async (db: Kysely<any>) => createMetadataTable(db, "pi_ext_metadata"),
      down: async (db: Kysely<any>) => dropTable(db, "pi_ext_metadata"),
    },
  });

  registry.register("project", "core", {
    "0001_create_project_metadata": {
      up: async (db: Kysely<any>) => createMetadataTable(db, "pi_ext_project_metadata"),
      down: async (db: Kysely<any>) => dropTable(db, "pi_ext_project_metadata"),
    },
  });
}

async function createMetadataTable(db: Kysely<any>, tableName: string): Promise<void> {
  await db.schema
    .createTable(tableName)
    .ifNotExists()
    .addColumn("key", "text", (col) => col.primaryKey().notNull())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updated_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();
}

async function dropTable(db: Kysely<any>, tableName: string): Promise<void> {
  await db.schema.dropTable(tableName).ifExists().execute();
}
