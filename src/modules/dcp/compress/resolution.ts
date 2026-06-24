import { parseBlockRef, parseMessageRef } from "../message-ids";
import type { ContextFrame, DcpState } from "../state/types";

export interface RangeEntry {
  startId: string;
  endId: string;
  summary: string;
}

export interface MessageEntry {
  messageId: string;
  topic: string;
  summary: string;
}

export interface ResolvedSelection {
  startIndex: number;
  endIndex: number;
  frames: ContextFrame[];
  consumedBlockIds: number[];
}

export function resolveRange(
  entry: RangeEntry,
  frames: ContextFrame[],
  state: DcpState,
): ResolvedSelection {
  const startIndex = boundaryIndex(entry.startId, frames, state);
  const endIndex = boundaryIndex(entry.endId, frames, state);
  if (startIndex === null)
    throw new Error(`Unknown compression startId: ${entry.startId}`);
  if (endIndex === null)
    throw new Error(`Unknown compression endId: ${entry.endId}`);
  if (startIndex > endIndex)
    throw new Error(
      `Compression startId must appear before endId: ${entry.startId} > ${entry.endId}`,
    );
  const selectedFrames = frames.slice(startIndex, endIndex + 1);
  const consumedBlockIds = activeBlocksInsideSelection(
    state,
    selectedFrames.map((frame) => frame.entryId),
  );
  return { startIndex, endIndex, frames: selectedFrames, consumedBlockIds };
}

export function resolveMessage(
  messageId: string,
  frames: ContextFrame[],
): ContextFrame {
  const index = parseMessageRef(messageId);
  if (index === null) throw new Error(`Invalid messageId: ${messageId}`);
  const frame = frames[index - 1];
  if (!frame) throw new Error(`Unknown messageId: ${messageId}`);
  return frame;
}

export function validateNonOverlapping(selections: ResolvedSelection[]): void {
  const ordered = [...selections].sort((a, b) => a.startIndex - b.startIndex);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]!.startIndex <= ordered[index - 1]!.endIndex)
      throw new Error("Compression ranges must not overlap");
  }
}

function boundaryIndex(
  id: string,
  frames: ContextFrame[],
  state: DcpState,
): number | null {
  const messageIndex = parseMessageRef(id);
  if (messageIndex !== null)
    return frames[messageIndex - 1] ? messageIndex - 1 : null;
  const blockId = parseBlockRef(id);
  if (blockId === null) return null;
  const block = state.blocks.get(blockId);
  if (!block) return null;
  return frames.findIndex((frame) => frame.entryId === block.anchorEntryId);
}

function activeBlocksInsideSelection(
  state: DcpState,
  entryIds: string[],
): number[] {
  const selected = new Set(entryIds);
  const consumed: number[] = [];
  for (const blockId of state.activeBlockIds) {
    const block = state.blocks.get(blockId);
    if (block && selected.has(block.anchorEntryId)) consumed.push(blockId);
  }
  return consumed;
}
