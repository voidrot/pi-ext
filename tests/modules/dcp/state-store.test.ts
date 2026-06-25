import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialState,
  deserializeState,
  restoreStateFromBranch,
  serializeState,
} from "../../../src/modules/dcp/state/store";

test("restores latest pi-dcp-state custom entry from branch", () => {
  const first = createInitialState();
  first.manualMode = true;
  const second = createInitialState();
  second.nextBlockId = 4;

  const branch = [
    {
      type: "custom",
      customType: "pi-dcp-state",
      data: { version: 1, state: serializeState(first) },
    },
    { type: "custom", customType: "other", data: { version: 1 } },
    {
      type: "custom",
      customType: "pi-dcp-state",
      data: { version: 1, state: serializeState(second) },
    },
  ];

  const restored = restoreStateFromBranch(branch);
  assert.equal(restored.nextBlockId, 4);
  assert.equal(restored.manualMode, false);
});

test("serializes new DCP retention metadata", () => {
  const state = createInitialState();
  state.toolCalls.set("call_1", {
    id: "call_1",
    toolName: "bash",
    turn: 2,
    status: "completed",
  });
  state.messageTurns.set("e1", 2);

  const restored = deserializeState(serializeState(state));

  assert.deepEqual(restored.toolCalls.get("call_1"), {
    id: "call_1",
    toolName: "bash",
    turn: 2,
    status: "completed",
  });
  assert.equal(restored.messageTurns.get("e1"), 2);
});

test("falls back to initial state when no state entries exist", () => {
  const restored = restoreStateFromBranch([]);
  assert.equal(restored.nextBlockId, 1);
  assert.equal(restored.nextRunId, 1);
  assert.equal(restored.blocks.size, 0);
});
