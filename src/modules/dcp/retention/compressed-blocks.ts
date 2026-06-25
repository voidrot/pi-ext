import type { DcpConfig } from "../config";
import { deactivateBlock } from "../state/store";
import type { ContextFrame, DcpState } from "../state/types";

export interface CompressedBlockRetentionResult {
  deactivatedBlockIds: number[];
}

export function applyCompressedBlockRetention(
  state: DcpState,
  frames: ContextFrame[],
  staleToolCallIds: Set<string>,
  _config: DcpConfig,
): CompressedBlockRetentionResult {
  const frameEntryIds = new Set(frames.map((frame) => frame.entryId));
  const frameByEntryId = new Map(frames.map((frame) => [frame.entryId, frame]));
  const deactivatedBlockIds: number[] = [];

  for (const blockId of [...state.activeBlockIds]) {
    const block = state.blocks.get(blockId);
    if (!block || !block.active) continue;

    const hasBranchEntries = block.effectiveEntryIds.some((entryId) => frameEntryIds.has(entryId));
    const isNetNegative = block.summaryTokens >= block.compressedTokens;
    const isOnlyStaleTools =
      block.effectiveToolCallIds.length > 0 &&
      block.effectiveToolCallIds.every((id) => staleToolCallIds.has(id)) &&
      block.effectiveEntryIds.every((entryId) => {
        const frame = frameByEntryId.get(entryId);
        return frame?.role === "assistant" || frame?.role === "toolResult";
      });

    if (!hasBranchEntries || isNetNegative || isOnlyStaleTools) {
      deactivateBlock(state, blockId);
      deactivatedBlockIds.push(blockId);
    }
  }

  return { deactivatedBlockIds };
}
