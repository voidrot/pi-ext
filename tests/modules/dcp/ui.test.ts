import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/modules/dcp/state/store";
import type { CompressionBlock } from "../../../src/modules/dcp/state/types";
import {
  DCP_COMPRESSED_BLOCKS_WIDGET_ID,
  buildDcpStatsLines,
  clearDcpWidget,
  formatCompressionNotification,
  formatCompressedBlocksWidget,
  isDcpStatsOverlayCloseInput,
  syncDcpWidget,
} from "../../../src/modules/dcp/ui";

function addBlock(overrides: Partial<CompressionBlock> = {}) {
  return {
    blockId: 1,
    runId: 7,
    active: true,
    topic: "closed research",
    mode: "range",
    startRef: "m0001",
    endRef: "m0004",
    anchorEntryId: "e1",
    originEntryId: "origin",
    directEntryIds: ["e1", "e2", "e3", "e4"],
    effectiveEntryIds: ["e1", "e2", "e3", "e4"],
    directToolCallIds: ["tool_1"],
    effectiveToolCallIds: ["tool_1"],
    consumedBlockIds: [],
    compressedTokens: 2450,
    summaryTokens: 180,
    createdAt: 123,
    summary: "High fidelity summary of the closed research work.",
    ...overrides,
  } satisfies CompressionBlock;
}

test("formats active compressed blocks for a persistent widget", () => {
  const state = createInitialState();
  const block = addBlock();
  state.blocks.set(block.blockId, block);
  state.activeBlockIds.add(block.blockId);

  const lines = formatCompressedBlocksWidget(state);

  assert.ok(lines);
  assert.match(lines![0]!, /DCP compressed context/);
  assert.match(lines![0]!, /1 active/);
  assert.match(lines![1]!, /b1/);
  assert.match(lines![1]!, /closed research/);
  assert.match(lines![1]!, /m0001 → m0004/);
  assert.match(lines![1]!, /4 items/);
  assert.match(lines![1]!, /-2\.5k/);
  assert.match(lines![1]!, /\+180/);
});

test("does not render a widget when no compression blocks are active", () => {
  const lines = formatCompressedBlocksWidget(createInitialState());

  assert.equal(lines, undefined);
});

test("builds high-definition DCP stats lines", () => {
  const state = createInitialState();
  state.manualMode = true;
  state.turnCounter = 4;
  state.totalCompressedTokens = 2450;
  const block = addBlock();
  state.blocks.set(block.blockId, block);
  state.activeBlockIds.add(block.blockId);
  state.nextBlockId = 2;
  state.nextRunId = 8;

  const lines = buildDcpStatsLines(state, 123_000);

  assert.match(lines.join("\n"), /high-definition stats/);
  assert.match(lines.join("\n"), /Manual mode: on/);
  assert.match(lines.join("\n"), /Blocks: 1 total, 1 active, 0 inactive/);
  assert.match(lines.join("\n"), /Tokens: -2\.5k total compressed, \+180 total summaries/);
  assert.match(lines.join("\n"), /b1 \| run #7 \| closed research/);
  assert.match(lines.join("\n"), /created 2m ago/);
});

test("recognizes raw and encoded DCP stats overlay close keys", () => {
  assert.equal(isDcpStatsOverlayCloseInput("q"), true);
  assert.equal(isDcpStatsOverlayCloseInput("Q"), true);
  assert.equal(isDcpStatsOverlayCloseInput("\x1b"), true);
  assert.equal(isDcpStatsOverlayCloseInput("escape"), true);
  assert.equal(isDcpStatsOverlayCloseInput("\x1b[27u"), true);
  assert.equal(isDcpStatsOverlayCloseInput("\x1b[27;1u"), true);
  assert.equal(isDcpStatsOverlayCloseInput("\x1b[27;1:3u"), true);
  assert.equal(isDcpStatsOverlayCloseInput("\x1b[27;1;27~"), true);
  assert.equal(isDcpStatsOverlayCloseInput("\x03"), true);
  assert.equal(isDcpStatsOverlayCloseInput("ctrl+c"), true);
  assert.equal(isDcpStatsOverlayCloseInput("x"), false);
});

test("formats compression toast details with optional summary preview", () => {
  const state = createInitialState();
  const block = addBlock();
  state.blocks.set(block.blockId, block);
  state.activeBlockIds.add(block.blockId);

  const hidden = formatCompressionNotification(state, {
    blockIds: [1],
    compressedTokens: 2450,
    summaryTokens: 180,
  }, false);
  const shown = formatCompressionNotification(state, {
    blockIds: [1],
    compressedTokens: 2450,
    summaryTokens: 180,
  }, true);

  assert.match(hidden, /DCP compressed 1 block/);
  assert.match(hidden, /-2\.5k removed/);
  assert.match(hidden, /\+180 summary/);
  assert.match(hidden, /closed research/);
  assert.doesNotMatch(hidden, /High fidelity summary/);
  assert.match(shown, /High fidelity summary/);
});

test("syncDcpWidget respects widget config and clears stale UI", () => {
  const state = createInitialState();
  const block = addBlock();
  state.blocks.set(block.blockId, block);
  state.activeBlockIds.add(block.blockId);
  const calls: Array<{ key: string; content: unknown }> = [];
  const ctx = {
    hasUI: true,
    ui: {
      setWidget: (key: string, content: unknown) => calls.push({ key, content }),
    },
  } as any;

  syncDcpWidget(ctx, state, { compressedBlocksWidget: true });
  syncDcpWidget(ctx, state, { compressedBlocksWidget: false });
  clearDcpWidget(ctx);

  assert.equal(calls[0]?.key, DCP_COMPRESSED_BLOCKS_WIDGET_ID);
  assert.ok(Array.isArray(calls[0]?.content));
  assert.deepEqual(calls.slice(1), [
    { key: DCP_COMPRESSED_BLOCKS_WIDGET_ID, content: undefined },
    { key: DCP_COMPRESSED_BLOCKS_WIDGET_ID, content: undefined },
  ]);
});

test("notifyCompression respects notification config", async () => {
  const { notifyCompression } = await import("../../../src/modules/dcp/ui");
  const state = createInitialState();
  const block = addBlock();
  state.blocks.set(block.blockId, block);
  state.activeBlockIds.add(block.blockId);
  const notifications: Array<{ message: string; type: string | undefined }> = [];
  const ctx = {
    hasUI: true,
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
    },
  } as any;
  const config = {
    compress: { showCompression: false },
    ui: { compressionNotifications: true },
  } as any;

  notifyCompression(ctx, state, { blockIds: [1], compressedTokens: 2450, summaryTokens: 180 }, config);
  notifyCompression(ctx, state, { blockIds: [1], compressedTokens: 2450, summaryTokens: 180 }, {
    ...config,
    ui: { compressionNotifications: false },
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.type, "info");
  assert.match(notifications[0]!.message, /DCP compressed 1 block/);
});
