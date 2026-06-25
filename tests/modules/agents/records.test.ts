import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubagentRunStore } from "../../../src/modules/agents/records";

test("creates records and enforces state transitions", () => {
  const store = createSubagentRunStore({ now: () => 10, id: () => "task-1" });
  const record = store.create({ agent: "scout", prompt: "Find auth", background: true });

  assert.equal(record.id, "task-1");
  assert.equal(record.status, "queued");

  store.update("task-1", { status: "running", sessionId: "child-1", transcriptPath: "/tmp/child.jsonl" });
  store.update("task-1", { status: "completed", output: "done", completedAt: 20 });

  const current = store.get("task-1");
  assert.equal(current?.status, "completed");
  assert.equal(current?.output, "done");
  assert.equal(current?.transcriptPath, "/tmp/child.jsonl");
});

test("lists records newest first", () => {
  let now = 0;
  let seq = 0;
  const store = createSubagentRunStore({ now: () => ++now, id: () => `task-${++seq}` });

  store.create({ agent: "a", prompt: "one", background: false });
  store.create({ agent: "b", prompt: "two", background: false });

  assert.deepEqual(store.list().map((record) => record.id), ["task-2", "task-1"]);
});
