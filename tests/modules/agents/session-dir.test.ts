import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveSubagentSessionDir } from "../../../src/modules/agents/session-dir";

test("derives child transcript directory below parent session basename", () => {
  const parent = "/home/me/.pi/agent/sessions/repo/2026-06-24T12-00-00Z_.jsonl";

  assert.equal(
    deriveSubagentSessionDir(parent, "/repo"),
    "/home/me/.pi/agent/sessions/repo/2026-06-24T12-00-00Z_/tasks",
  );
});

test("falls back to temp directory when parent session is not persisted", () => {
  const dir = deriveSubagentSessionDir(undefined, "/home/me/project");

  assert.equal(dir, join(tmpdir(), `pi-ext-subagents-${process.getuid?.() ?? 0}`, "home-me-project", "tasks"));
});
