import assert from "node:assert/strict";
import test from "node:test";
import { applyRangeCompression } from "../../../src/modules/dcp/compress/state";
import { defaultConfig } from "../../../src/modules/dcp/config";
import { createInitialState } from "../../../src/modules/dcp/state/store";

test("applies range compression and activates a block", () => {
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
    {
      ref: "m0002",
      entryId: "e2",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: 2,
      },
      tokenCount: 20,
      toolCallIds: ["call_1"],
      role: "assistant",
    },
  ];

  const result = applyRangeCompression(
    state,
    frames,
    "origin",
    {
      topic: "closed work",
      content: [{ startId: "m0001", endId: "m0002", summary: "finished work" }],
    },
    defaultConfig,
  );

  assert.deepEqual(result.blockIds, [1]);
  assert.equal(state.blocks.get(1)?.anchorEntryId, "e1");
  assert.deepEqual(state.blocks.get(1)?.effectiveEntryIds, ["e1", "e2"]);
  assert.equal(state.nextBlockId, 2);
});
