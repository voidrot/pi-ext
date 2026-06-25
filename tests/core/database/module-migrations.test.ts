import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Kysely } from "kysely";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";

function createCtx(cwd: string): any {
  return { cwd, isProjectTrusted: () => true };
}

test("module-owned project migrations run on startup initialization", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-module-migrations-"));
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  registry.register("project", "dcp", {
    "0001_create_test_table": {
      up: async (db: Kysely<any>) => {
        await db.schema.createTable("dcp_test_table").addColumn("id", "integer", (col) => col.primaryKey()).execute();
      },
      down: async (db: Kysely<any>) => {
        await db.schema.dropTable("dcp_test_table").ifExists().execute();
      },
    },
  });

  const manager = new DatabaseManager({ agentDir, registry });
  const handles = await manager.ensureInitialized(createCtx(cwd));

  const rows = await (handles.project!.db as Kysely<any>).selectFrom("dcp_test_table").select("id").execute();
  assert.deepEqual(rows, []);

  await manager.destroy();
});
