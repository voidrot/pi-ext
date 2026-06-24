import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CompressionBlock, DcpState, SerializedDcpState } from "./types";

export const DCP_STATE_CUSTOM_TYPE = "pi-dcp-state";

export function createInitialState(): DcpState {
  return {
    version: 1,
    manualMode: false,
    nextBlockId: 1,
    nextRunId: 1,
    blocks: new Map<number, CompressionBlock>(),
    activeBlockIds: new Set<number>(),
    totalCompressedTokens: 0,
    turnCounter: 0,
  };
}

export function serializeState(state: DcpState): SerializedDcpState {
  return {
    version: 1,
    manualMode: state.manualMode,
    nextBlockId: state.nextBlockId,
    nextRunId: state.nextRunId,
    blocks: Array.from(state.blocks.entries()),
    activeBlockIds: Array.from(state.activeBlockIds),
    totalCompressedTokens: state.totalCompressedTokens,
    turnCounter: state.turnCounter,
  };
}

export function deserializeState(input: unknown): DcpState {
  if (!input || typeof input !== "object") return createInitialState();
  const raw = input as Partial<SerializedDcpState>;
  const state = createInitialState();
  state.manualMode = raw.manualMode === true;
  state.nextBlockId =
    Number.isInteger(raw.nextBlockId) && raw.nextBlockId! > 0
      ? raw.nextBlockId!
      : 1;
  state.nextRunId =
    Number.isInteger(raw.nextRunId) && raw.nextRunId! > 0 ? raw.nextRunId! : 1;
  state.totalCompressedTokens =
    typeof raw.totalCompressedTokens === "number"
      ? Math.max(0, raw.totalCompressedTokens)
      : 0;
  state.turnCounter =
    typeof raw.turnCounter === "number" ? Math.max(0, raw.turnCounter) : 0;
  if (Array.isArray(raw.blocks)) {
    for (const [id, block] of raw.blocks) {
      if (
        Number.isInteger(id) &&
        id > 0 &&
        block &&
        typeof block === "object"
      ) {
        state.blocks.set(id, block);
      }
    }
  }
  if (Array.isArray(raw.activeBlockIds)) {
    for (const id of raw.activeBlockIds) {
      if (Number.isInteger(id) && id > 0 && state.blocks.has(id))
        state.activeBlockIds.add(id);
    }
  }
  return state;
}

export function restoreStateFromBranch(branch: unknown[]): DcpState {
  let latest: unknown;
  for (const entry of branch) {
    const item = entry as {
      type?: string;
      customType?: string;
      data?: { version?: number; state?: unknown };
    };
    if (
      item.type === "custom" &&
      item.customType === DCP_STATE_CUSTOM_TYPE &&
      item.data?.version === 1
    ) {
      latest = item.data.state;
    }
  }
  return deserializeState(latest);
}

export function appendStateEntry(pi: ExtensionAPI, state: DcpState): void {
  pi.appendEntry(DCP_STATE_CUSTOM_TYPE, {
    version: 1,
    state: serializeState(state),
  });
}

export function deactivateBlock(state: DcpState, blockId: number): boolean {
  const block = state.blocks.get(blockId);
  if (!block) return false;
  block.active = false;
  state.activeBlockIds.delete(blockId);
  return true;
}
