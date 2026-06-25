import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveGlobalDatabasePath, resolveProjectDatabasePath } from "../../../src/core/database/paths";

const root = mkdtempSync(join(tmpdir(), "pi-ext-db-paths-"));

test("resolves global database beside the agent directory", () => {
  const agentDir = join(root, ".pi", "agent");
  assert.equal(resolveGlobalDatabasePath(agentDir), join(dirname(agentDir), "pi-ext.db"));
});

test("resolves project database under project .pi directory", () => {
  assert.equal(resolveProjectDatabasePath(root), join(root, ".pi", "pi-ext.db"));
});
