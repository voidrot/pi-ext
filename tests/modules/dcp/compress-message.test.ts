import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/modules/dcp/state/store";
import { applyMessageCompression } from "../../../src/modules/dcp/compress/state";

test("applies message compression for selected messages", () => {
  const state = createInitialState();
  const frames = [
    {
      ref: "m0001",
      entryId: "e1",
      message: { role: "user", content: "old", timestamp: 1 },
      tokenCount: 10,
      toolCallIds: [],
      role: "user",
    },
  ];
  const result = applyMessageCompression(state, frames, "origin", {
    topic: "batch",
    content: [{ messageId: "m0001", topic: "old work", summary: "summary" }],
  });
  assert.deepEqual(result.blockIds, [1]);
  assert.equal(state.blocks.get(1)?.mode, "message");
  assert.equal(state.blocks.get(1)?.topic, "old work");
});
