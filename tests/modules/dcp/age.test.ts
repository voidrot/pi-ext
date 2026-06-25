import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../../../src/modules/dcp/config";
import { assignFrameTurns, getFrameAgeTurns, selectSummaryTier } from "../../../src/modules/dcp/retention/age";
import { createInitialState } from "../../../src/modules/dcp/state/store";

test("assigns first-seen turns to frames without overwriting existing ages", () => {
  const state = createInitialState();
  state.messageTurns.set("old", 1);
  const frames = [
    {
      ref: "m0001",
      entryId: "old",
      message: { role: "user", content: "old" },
      tokenCount: 1,
      toolCallIds: [],
      role: "user",
    },
    {
      ref: "m0002",
      entryId: "new",
      message: { role: "user", content: "new" },
      tokenCount: 1,
      toolCallIds: [],
      role: "user",
    },
  ];

  assignFrameTurns(state, frames, 7);

  assert.equal(state.messageTurns.get("old"), 1);
  assert.equal(state.messageTurns.get("new"), 7);
  assert.equal(getFrameAgeTurns(state, frames[0]!, 7), 6);
  assert.equal(getFrameAgeTurns(state, frames[1]!, 7), 0);
});

test("selects stricter summary tiers as selected content ages", () => {
  assert.deepEqual(selectSummaryTier(defaultConfig.compress.summaryTiers, 0), { minTurns: 0, maxSummaryRatio: 0.4 });
  assert.deepEqual(selectSummaryTier(defaultConfig.compress.summaryTiers, 5), { minTurns: 5, maxSummaryRatio: 0.25 });
  assert.deepEqual(selectSummaryTier(defaultConfig.compress.summaryTiers, 20), { minTurns: 15, maxSummaryRatio: 0.12 });
});
