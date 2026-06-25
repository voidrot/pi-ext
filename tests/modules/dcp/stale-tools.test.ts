import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../../../src/modules/dcp/config";
import { getStaleToolCallIds, stripStaleToolArtifacts } from "../../../src/modules/dcp/retention/stale-tools";
import { createInitialState } from "../../../src/modules/dcp/state/store";

test("finds stale unprotected tool calls after threshold", () => {
  const state = createInitialState();
  state.toolCalls.set("old", { id: "old", toolName: "bash", turn: 1, status: "completed" });
  state.toolCalls.set("new", { id: "new", toolName: "bash", turn: 6, status: "completed" });

  const stale = getStaleToolCallIds(state, 6, defaultConfig);

  assert.deepEqual([...stale], ["old"]);
});

test("removes stale assistant toolCall blocks and stale toolResult messages", () => {
  const assistant = {
    role: "assistant",
    content: [
      { type: "text", text: "I checked this." },
      { type: "toolCall", id: "old", name: "bash", arguments: { command: "ls" } },
      { type: "toolCall", id: "keep", name: "read", arguments: { path: "README.md" } },
    ],
  };
  const toolResult = {
    role: "toolResult",
    toolCallId: "old",
    toolName: "bash",
    content: [{ type: "text", text: "output" }],
    isError: false,
  };

  const strippedAssistant = stripStaleToolArtifacts(assistant, new Set(["old"]));
  const strippedResult = stripStaleToolArtifacts(toolResult, new Set(["old"]));

  assert.deepEqual(strippedAssistant?.content, [
    { type: "text", text: "I checked this." },
    { type: "toolCall", id: "keep", name: "read", arguments: { path: "README.md" } },
  ]);
  assert.equal(strippedResult, undefined);
});
