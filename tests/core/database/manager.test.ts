import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";

function createCtx(cwd: string, trusted: boolean): any {
  return { cwd, isProjectTrusted: () => trusted };
}

test("initializes global and trusted project databases", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-db-manager-"));
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  const manager = new DatabaseManager({ agentDir, registry });

  const handles = await manager.ensureInitialized(createCtx(cwd, true));

  assert.equal(existsSync(join(root, "home", ".pi", "pi-ext.db")), true);
  assert.equal(existsSync(join(root, "project", ".pi", "pi-ext.db")), true);
  assert.ok(handles.project);

  const globalRows = await handles.global.db.selectFrom("pi_ext_metadata").selectAll().execute();
  assert.deepEqual(globalRows, []);
  const projectRows = await handles.project!.db.selectFrom("pi_ext_project_metadata").selectAll().execute();
  assert.deepEqual(projectRows, []);

  await manager.destroy();
});

test("skips project database for untrusted projects", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-db-manager-"));
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  const manager = new DatabaseManager({ agentDir, registry });

  const handles = await manager.ensureInitialized(createCtx(cwd, false));

  assert.equal(existsSync(join(root, "home", ".pi", "pi-ext.db")), true);
  assert.equal(existsSync(join(root, "project", ".pi", "pi-ext.db")), false);
  assert.equal(handles.project, undefined);

  await manager.destroy();
});
