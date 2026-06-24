import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/modules/dcp/state/store";
import { transformMessagesForContext } from "../../../src/modules/dcp/context/transform";

test("injects ids and removes compressed raw messages", () => {
  const state = createInitialState();
  state.blocks.set(1, {
    blockId: 1,
    runId: 1,
    active: true,
    topic: "closed work",
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
    compressedTokens: 20,
    summaryTokens: 4,
    createdAt: 1,
    summary: "summary body",
  });
  state.activeBlockIds.add(1);

  const messages = [{ role: "user", content: "hello", timestamp: 1 }];
  const frames = [
    {
      ref: "m0001",
      entryId: "e1",
      message: messages[0],
      tokenCount: 2,
      toolCallIds: [],
      role: "user",
    },
  ];
  const result = transformMessagesForContext({
    messages,
    frames,
    state,
    usageTokens: null,
    config: undefined,
  });

  assert.equal(result.messages.length, 1);
  assert.match(
    String(result.messages[0].content),
    /\[Compressed conversation section\]/,
  );
  assert.match(String(result.messages[0].content), /summary body/);
  assert.match(
    String(result.messages[0].content),
    /<dcp-message-id>b1<\/dcp-message-id>/,
  );
});
