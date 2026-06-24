import { formatBlockRef, parseBlockRef } from "../message-ids";
import { estimateTokens } from "../token";
import type { CompressionBlock, ContextFrame, DcpState } from "../state/types";
import {
  resolveMessage,
  resolveRange,
  validateNonOverlapping,
  type MessageEntry,
  type RangeEntry,
} from "./resolution";

export interface RangeCompressionArgs {
  topic: string;
  content: RangeEntry[];
}

export interface MessageCompressionArgs {
  topic: string;
  content: MessageEntry[];
}

export interface CompressionApplyResult {
  blockIds: number[];
  compressedTokens: number;
  summaryTokens: number;
}

export function applyRangeCompression(
  state: DcpState,
  frames: ContextFrame[],
  originEntryId: string,
  args: RangeCompressionArgs,
): CompressionApplyResult {
  if (!args.topic.trim()) throw new Error("Compression topic is required");
  const selections = args.content.map((entry) => ({
    entry,
    selection: resolveRange(entry, frames, state),
  }));
  validateNonOverlapping(selections.map((item) => item.selection));
  const runId = allocateRunId(state);
  const blockIds: number[] = [];
  let compressedTokens = 0;
  let summaryTokens = 0;
  for (const { entry, selection } of selections) {
    const summary = expandBlockPlaceholders(
      entry.summary,
      state,
      selection.consumedBlockIds,
    );
    const result = createBlock(state, {
      runId,
      topic: args.topic,
      mode: "range",
      startRef: entry.startId,
      endRef: entry.endId,
      originEntryId,
      frames: selection.frames,
      consumedBlockIds: selection.consumedBlockIds,
      summary,
    });
    blockIds.push(result.blockId);
    compressedTokens += result.compressedTokens;
    summaryTokens += result.summaryTokens;
  }
  return { blockIds, compressedTokens, summaryTokens };
}

export function applyMessageCompression(
  state: DcpState,
  frames: ContextFrame[],
  originEntryId: string,
  args: MessageCompressionArgs,
): CompressionApplyResult {
  if (!args.topic.trim()) throw new Error("Compression topic is required");
  const runId = allocateRunId(state);
  const blockIds: number[] = [];
  let compressedTokens = 0;
  let summaryTokens = 0;
  for (const entry of args.content) {
    const frame = resolveMessage(entry.messageId, frames);
    const result = createBlock(state, {
      runId,
      topic: entry.topic || args.topic,
      mode: "message",
      startRef: entry.messageId,
      endRef: entry.messageId,
      originEntryId,
      frames: [frame],
      consumedBlockIds: [],
      summary: entry.summary,
    });
    blockIds.push(result.blockId);
    compressedTokens += result.compressedTokens;
    summaryTokens += result.summaryTokens;
  }
  return { blockIds, compressedTokens, summaryTokens };
}

function createBlock(
  state: DcpState,
  input: {
    runId: number;
    topic: string;
    mode: "range" | "message";
    startRef: string;
    endRef: string;
    originEntryId: string;
    frames: ContextFrame[];
    consumedBlockIds: number[];
    summary: string;
  },
): CompressionBlock & { blockId: number } {
  if (input.frames.length === 0)
    throw new Error("Cannot compress an empty selection");
  if (!input.summary.trim()) throw new Error("Compression summary is required");
  const blockId = allocateBlockId(state);
  const effectiveEntryIds = new Set(input.frames.map((frame) => frame.entryId));
  const effectiveToolCallIds = new Set(
    input.frames.flatMap((frame) => frame.toolCallIds),
  );
  for (const consumedId of input.consumedBlockIds) {
    const consumed = state.blocks.get(consumedId);
    if (!consumed) continue;
    consumed.active = false;
    state.activeBlockIds.delete(consumedId);
    consumed.effectiveEntryIds.forEach((id) => effectiveEntryIds.add(id));
    consumed.effectiveToolCallIds.forEach((id) => effectiveToolCallIds.add(id));
  }
  const compressedTokens = input.frames.reduce(
    (sum, frame) => sum + frame.tokenCount,
    0,
  );
  const summaryTokens = estimateTokens(input.summary);
  const block: CompressionBlock = {
    blockId,
    runId: input.runId,
    active: true,
    topic: input.topic,
    mode: input.mode,
    startRef: input.startRef,
    endRef: input.endRef,
    anchorEntryId: input.frames[0]!.entryId,
    originEntryId: input.originEntryId,
    directEntryIds: input.frames.map((frame) => frame.entryId),
    effectiveEntryIds: Array.from(effectiveEntryIds),
    directToolCallIds: Array.from(
      new Set(input.frames.flatMap((frame) => frame.toolCallIds)),
    ),
    effectiveToolCallIds: Array.from(effectiveToolCallIds),
    consumedBlockIds: [...input.consumedBlockIds],
    compressedTokens,
    summaryTokens,
    createdAt: Date.now(),
    summary: input.summary.trim(),
  };
  state.blocks.set(blockId, block);
  state.activeBlockIds.add(blockId);
  state.totalCompressedTokens += compressedTokens;
  return block;
}

function allocateBlockId(state: DcpState): number {
  const id = state.nextBlockId;
  state.nextBlockId += 1;
  return id;
}

function allocateRunId(state: DcpState): number {
  const id = state.nextRunId;
  state.nextRunId += 1;
  return id;
}

function expandBlockPlaceholders(
  summary: string,
  state: DcpState,
  requiredBlockIds: number[],
): string {
  let expanded = summary;
  for (const blockId of requiredBlockIds) {
    const marker = `(${formatBlockRef(blockId)})`;
    const block = state.blocks.get(blockId);
    if (!block) continue;
    if (!expanded.includes(marker)) {
      expanded += `\n\n${block.summary}`;
      continue;
    }
    expanded = expanded.replaceAll(marker, block.summary);
  }
  return expanded.replace(/\((b[1-9]\d*)\)/g, (raw, ref: string) => {
    const id = parseBlockRef(ref);
    const block = id ? state.blocks.get(id) : undefined;
    return block ? block.summary : raw;
  });
}
