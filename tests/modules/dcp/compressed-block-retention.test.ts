import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../../../src/modules/dcp/config";
import { applyCompressedBlockRetention } from "../../../src/modules/dcp/retention/compressed-blocks";
import { createInitialState } from "../../../src/modules/dcp/state/store";

test("deactivates active blocks whose entries are no longer on the current branch", () => {
  const state = createInitialState();
  state.blocks.set(1, {
    blockId: 1,
    runId: 1,
    active: true,
    topic: "orphan",
    mode: "range",
    startRef: "m0001",
    endRef: "m0002",
    anchorEntryId: "missing",
    originEntryId: "origin",
    directEntryIds: ["missing"],
    effectiveEntryIds: ["missing"],
    directToolCallIds: [],
    effectiveToolCallIds: [],
    consumedBlockIds: [],
    compressedTokens: 100,
    summaryTokens: 20,
    createdAt: 1,
    createdTurn: 1,
    summary: "orphan summary",
  });
  state.activeBlockIds.add(1);

  const result = applyCompressedBlockRetention(state, [], new Set(), defaultConfig);

  assert.deepEqual(result.deactivatedBlockIds, [1]);
  assert.equal(state.blocks.get(1)?.active, false);
  assert.equal(state.activeBlockIds.has(1), false);
});

test("deactivates net-negative compression blocks", () => {
  const state = createInitialState();
  state.blocks.set(1, {
    blockId: 1,
    runId: 1,
    active: true,
    topic: "bad",
    mode: "range",
    startRef: "m0001",
    endRef: "m0001",
    anchorEntryId: "e1",
    originEntryId: "origin",
    directEntryIds: ["e1"],
    effectiveEntryIds: ["e1"],
    directToolCallIds: [],
    effectiveToolCallIds: [],
    consumedBlockIds: [],
    compressedTokens: 10,
    summaryTokens: 12,
    createdAt: 1,
    createdTurn: 1,
    summary: "larger than raw",
  });
  state.activeBlockIds.add(1);

  const frames = [
    {
      ref: "m0001",
      entryId: "e1",
      message: { role: "user", content: "x" },
      tokenCount: 10,
      toolCallIds: [],
      role: "user",
    },
  ];
  const result = applyCompressedBlockRetention(state, frames, new Set(), defaultConfig);

  assert.deepEqual(result.deactivatedBlockIds, [1]);
});

test("deactivates blocks fully covered by stale tool stripping", () => {
  const state = createInitialState();
  state.blocks.set(1, {
    blockId: 1,
    runId: 1,
    active: true,
    topic: "tool only",
    mode: "range",
    startRef: "m0001",
    endRef: "m0002",
    anchorEntryId: "e1",
    originEntryId: "origin",
    directEntryIds: ["e1", "e2"],
    effectiveEntryIds: ["e1", "e2"],
    directToolCallIds: ["call_old"],
    effectiveToolCallIds: ["call_old"],
    consumedBlockIds: [],
    compressedTokens: 500,
    summaryTokens: 50,
    createdAt: 1,
    createdTurn: 1,
    summary: "tool transcript summary",
  });
  state.activeBlockIds.add(1);

  const frames = [
    {
      ref: "m0001",
      entryId: "e1",
      message: { role: "assistant", content: [{ type: "toolCall", id: "call_old", name: "bash", arguments: {} }] },
      tokenCount: 50,
      toolCallIds: ["call_old"],
      role: "assistant",
    },
    {
      ref: "m0002",
      entryId: "e2",
      message: {
        role: "toolResult",
        toolCallId: "call_old",
        toolName: "bash",
        content: [{ type: "text", text: "out" }],
        isError: false,
      },
      tokenCount: 450,
      toolCallIds: ["call_old"],
      role: "toolResult",
    },
  ];

  const result = applyCompressedBlockRetention(state, frames, new Set(["call_old"]), defaultConfig);

  assert.deepEqual(result.deactivatedBlockIds, [1]);
});
