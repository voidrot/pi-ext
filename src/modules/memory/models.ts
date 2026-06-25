import type { Generated, Kysely } from "kysely";
import { sql } from "kysely";
import type { MigrationMap } from "../../core/database/registry";
import { defineTableModel, type DatabaseScope } from "../../core/database/schema";
import { MEMORY_VECTOR_DIMENSIONS } from "./vector";

export type MemoryScope = "global" | "project" | "session";
export type ProjectMemoryScope = "project" | "session";

export interface MemoryMigrationRegistry {
  register(scope: DatabaseScope, moduleId: string, migrations: MigrationMap): void;
}

export interface GlobalMemoryTable {
  id: string;
  content: string;
  title: string | null;
  tags_json: string;
  importance: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ProjectMemoryTable {
  id: string;
  scope: ProjectMemoryScope;
  session_id: string | null;
  content: string;
  title: string | null;
  tags_json: string;
  importance: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type MemoryVectorStatus = "pending" | "completed" | "failed";

export interface MemoryVectorTable {
  rowid: Generated<number>;
  memory_id: string;
  embedding: Buffer;
}

export interface MemoryVectorMetadataTable {
  memory_id: string;
  provider: string | null;
  model: string | null;
  dimensions: number;
  source_hash: string;
  status: MemoryVectorStatus;
  error: string | null;
  generated_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

declare module "../../core/database/schema" {
  interface GlobalDatabase {
    pi_ext_global_memories: GlobalMemoryTable;
    pi_ext_global_memory_vectors: MemoryVectorTable;
    pi_ext_global_memory_vector_metadata: MemoryVectorMetadataTable;
  }

  interface ProjectDatabase {
    pi_ext_project_memories: ProjectMemoryTable;
    pi_ext_project_memory_vectors: MemoryVectorTable;
    pi_ext_project_memory_vector_metadata: MemoryVectorMetadataTable;
  }
}

export const globalMemoryModel = defineTableModel({ scope: "global", tableName: "pi_ext_global_memories" });
export const projectMemoryModel = defineTableModel({ scope: "project", tableName: "pi_ext_project_memories" });

export function registerMemoryDatabaseMigrations(registry: MemoryMigrationRegistry): void {
  registry.register("global", "memory", {
    "0001_create_global_memories": {
      up: async (db: Kysely<any>) => createGlobalMemoriesTable(db),
      down: async (db: Kysely<any>) => db.schema.dropTable("pi_ext_global_memories").ifExists().execute(),
    },
    "0002_create_global_memory_vectors": {
      up: async (db: Kysely<any>) => createMemoryVectorTable(db, "pi_ext_global_memory_vectors"),
      down: async (db: Kysely<any>) => { await sql`drop table if exists pi_ext_global_memory_vectors`.execute(db); },
    },
    "0003_create_global_memory_vector_metadata": {
      up: async (db: Kysely<any>) => createMemoryVectorMetadataTable(db, "pi_ext_global_memory_vector_metadata"),
      down: async (db: Kysely<any>) => db.schema.dropTable("pi_ext_global_memory_vector_metadata").ifExists().execute(),
    },
  });

  registry.register("project", "memory", {
    "0001_create_project_memories": {
      up: async (db: Kysely<any>) => createProjectMemoriesTable(db),
      down: async (db: Kysely<any>) => db.schema.dropTable("pi_ext_project_memories").ifExists().execute(),
    },
    "0002_create_project_memory_vectors": {
      up: async (db: Kysely<any>) => createMemoryVectorTable(db, "pi_ext_project_memory_vectors"),
      down: async (db: Kysely<any>) => { await sql`drop table if exists pi_ext_project_memory_vectors`.execute(db); },
    },
    "0003_create_project_memory_vector_metadata": {
      up: async (db: Kysely<any>) => createMemoryVectorMetadataTable(db, "pi_ext_project_memory_vector_metadata"),
      down: async (db: Kysely<any>) => db.schema.dropTable("pi_ext_project_memory_vector_metadata").ifExists().execute(),
    },
  });
}

async function createGlobalMemoriesTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("pi_ext_global_memories")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey().notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("title", "text")
    .addColumn("tags_json", "text", (col) => col.defaultTo("[]").notNull())
    .addColumn("importance", "integer", (col) => col.defaultTo(3).notNull())
    .addColumn("created_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updated_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("idx_pi_ext_global_memories_importance_created")
    .ifNotExists()
    .on("pi_ext_global_memories")
    .columns(["importance", "created_at"])
    .execute();
}

async function createMemoryVectorTable(db: Kysely<any>, tableName: string): Promise<void> {
  await sql.raw(`create virtual table if not exists ${tableName} using vec0(embedding float[${MEMORY_VECTOR_DIMENSIONS}], memory_id text)`).execute(db);
}

async function createMemoryVectorMetadataTable(db: Kysely<any>, tableName: string): Promise<void> {
  await db.schema
    .createTable(tableName)
    .ifNotExists()
    .addColumn("memory_id", "text", (col) => col.primaryKey().notNull())
    .addColumn("provider", "text")
    .addColumn("model", "text")
    .addColumn("dimensions", "integer", (col) => col.defaultTo(MEMORY_VECTOR_DIMENSIONS).notNull())
    .addColumn("source_hash", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.defaultTo("pending").notNull().check(sql`status in ('pending', 'completed', 'failed')`))
    .addColumn("error", "text")
    .addColumn("generated_at", "text")
    .addColumn("created_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updated_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex(`idx_${tableName}_status_updated`)
    .ifNotExists()
    .on(tableName)
    .columns(["status", "updated_at"])
    .execute();
}

async function createProjectMemoriesTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("pi_ext_project_memories")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey().notNull())
    .addColumn("scope", "text", (col) => col.notNull().check(sql`scope in ('project', 'session')`))
    .addColumn("session_id", "text")
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("title", "text")
    .addColumn("tags_json", "text", (col) => col.defaultTo("[]").notNull())
    .addColumn("importance", "integer", (col) => col.defaultTo(3).notNull())
    .addColumn("created_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updated_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("idx_pi_ext_project_memories_scope_session")
    .ifNotExists()
    .on("pi_ext_project_memories")
    .columns(["scope", "session_id"])
    .execute();
  await db.schema
    .createIndex("idx_pi_ext_project_memories_importance_created")
    .ifNotExists()
    .on("pi_ext_project_memories")
    .columns(["importance", "created_at"])
    .execute();
}
