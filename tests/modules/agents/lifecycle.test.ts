import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENTS_CHILD_COMPLETED,
  AGENTS_CHILD_FAILED,
  AGENTS_CHILD_STALLED,
  createAgentsLifecyclePublisher,
} from "../../../src/modules/agents/lifecycle";

test("publishes child lifecycle events on injected emitter", () => {
  const events: Array<{ channel: string; data: unknown }> = [];
  const lifecycle = createAgentsLifecyclePublisher((channel, data) => events.push({ channel, data }));

  lifecycle.completed({ taskId: "task-1", agentName: "scout", status: "completed", output: "done" });
  lifecycle.failed({ taskId: "task-2", agentName: "critic", status: "failed", error: "boom" });
  lifecycle.stalled({ taskId: "task-3", agentName: "slow", status: "stalled", idleMs: 1000 });

  assert.deepEqual(events.map((event) => event.channel), [AGENTS_CHILD_COMPLETED, AGENTS_CHILD_FAILED, AGENTS_CHILD_STALLED]);
});
