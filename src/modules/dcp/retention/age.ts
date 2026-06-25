import type { CompressionSummaryTier } from "../config";
import type { ContextFrame, DcpState } from "../state/types";

export function assignFrameTurns(state: DcpState, frames: ContextFrame[], currentTurn: number): void {
  for (const frame of frames) {
    if (!state.messageTurns.has(frame.entryId)) {
      state.messageTurns.set(frame.entryId, currentTurn);
    }
  }
}

export function getFrameAgeTurns(state: DcpState, frame: ContextFrame, currentTurn: number): number {
  const turn = state.messageTurns.get(frame.entryId) ?? currentTurn;
  return Math.max(0, currentTurn - turn);
}

export function getYoungestFrameAgeTurns(state: DcpState, frames: ContextFrame[], currentTurn: number): number {
  if (frames.length === 0) return 0;
  return Math.min(...frames.map((frame) => getFrameAgeTurns(state, frame, currentTurn)));
}

export function selectSummaryTier(tiers: CompressionSummaryTier[], ageTurns: number): CompressionSummaryTier {
  let selected = tiers[0]!;
  for (const tier of tiers) {
    if (ageTurns >= tier.minTurns) selected = tier;
  }
  return selected;
}
