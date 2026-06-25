import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Kysely } from "kysely";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";
import { registerMemoryDatabaseMigrations } from "../../../src/modules/memory/models";

function createCtx(cwd: string): any {
  return { cwd, isProjectTrusted: () => true };
}

test("memory migrations create global and project memory tables", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-memory-models-"));
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  registerMemoryDatabaseMigrations(registry);

  const manager = new DatabaseManager({ agentDir, registry });
  const handles = await manager.ensureInitialized(createCtx(cwd));

  await (handles.global.db as Kysely<any>)
    .insertInto("pi_ext_global_memories")
    .values({ id: "g1", content: "Global preference", tags_json: "[]", importance: 3 })
    .execute();

  await (handles.project!.db as Kysely<any>)
    .insertInto("pi_ext_project_memories")
    .values({ id: "p1", scope: "project", content: "Project fact", tags_json: "[]", importance: 3 })
    .execute();

  const globalRows = await (handles.global.db as Kysely<any>).selectFrom("pi_ext_global_memories").selectAll().execute();
  const projectRows = await (handles.project!.db as Kysely<any>).selectFrom("pi_ext_project_memories").selectAll().execute();

  assert.equal(globalRows.length, 1);
  assert.equal(projectRows.length, 1);

  await manager.destroy();
});
