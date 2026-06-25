import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../../../src/modules/dcp/config";
import { applyRangeCompression } from "../../../src/modules/dcp/compress/state";
import { createInitialState } from "../../../src/modules/dcp/state/store";

test("rejects summaries that exceed the age-tier budget", () => {
  const state = createInitialState();
  state.turnCounter = 20;
  state.messageTurns.set("e1", 1);
  const frames = [
    {
      ref: "m0001",
      entryId: "e1",
      message: { role: "user", content: "x" },
      tokenCount: 100,
      toolCallIds: [],
      role: "user",
    },
  ];

  assert.throws(
    () =>
      applyRangeCompression(
        state,
        frames,
        "origin",
        {
          topic: "old work",
          content: [{ startId: "m0001", endId: "m0001", summary: "x ".repeat(80) }],
        },
        defaultConfig,
      ),
    /Compression summary too long/,
  );
});

test("allows summaries within the selected age-tier budget", () => {
  const state = createInitialState();
  state.turnCounter = 20;
  state.messageTurns.set("e1", 1);
  const frames = [
    {
      ref: "m0001",
      entryId: "e1",
      message: { role: "user", content: "x" },
      tokenCount: 1000,
      toolCallIds: [],
      role: "user",
    },
  ];

  const result = applyRangeCompression(
    state,
    frames,
    "origin",
    {
      topic: "old work",
      content: [{ startId: "m0001", endId: "m0001", summary: "short durable summary" }],
    },
    defaultConfig,
  );

  assert.deepEqual(result.blockIds, [1]);
});
