import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotificationBridge, formatSubagentNotification } from "../../../src/modules/agents/notifications";
import type { SubagentRunRecord } from "../../../src/modules/agents/records";

function record(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    id: "task-1",
    agent: "scout",
    prompt: "Find auth",
    status: "completed",
    background: true,
    createdAt: 1,
    updatedAt: 2,
    lastActivityAt: 2,
    turnCount: 1,
    toolUseCount: 0,
    output: "done",
    transcriptPath: "/tmp/child.jsonl",
    ...overrides,
  };
}

test("formats machine-readable parent notifications", () => {
  const text = formatSubagentNotification(record({ output: "line 1\nline 2" }), 20);

  assert.match(text, /<subagent-notification>/);
  assert.match(text, /<task-id>task-1<\/task-id>/);
  assert.match(text, /<status>completed<\/status>/);
  assert.match(text, /<transcript>\/tmp\/child.jsonl<\/transcript>/);
});

test("sends background notifications as follow-up turns", () => {
  const sent: any[] = [];
  const bridge = createNotificationBridge((message, options) => sent.push({ message, options }));

  bridge.notify(record());

  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.customType, "pi-ext-agents-notification");
  assert.equal(sent[0].options.deliverAs, "followUp");
  assert.equal(sent[0].options.triggerTurn, true);
});
