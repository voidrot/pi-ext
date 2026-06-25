import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";

const migration = { up: async () => undefined, down: async () => undefined };

test("prefixes migrations by scope and module id", async () => {
  const registry = new DatabaseMigrationRegistry();
  registry.register("global", "core", { "0001_create_metadata": migration });

  const migrations = await registry.createProvider("global").getMigrations();
  assert.deepEqual(Object.keys(migrations), ["core__0001_create_metadata"]);
});

test("rejects duplicate migration names within a scope", () => {
  const registry = new DatabaseMigrationRegistry();
  registry.register("project", "core", { "0001_init": migration });

  assert.throws(
    () => registry.register("project", "core", { "0001_init": migration }),
    /Duplicate project migration core__0001_init/,
  );
});
