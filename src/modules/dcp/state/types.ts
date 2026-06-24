export type CompressionMode = "range" | "message";

export interface CompressionBlock {
  blockId: number;
  runId: number;
  active: boolean;
  topic: string;
  mode: CompressionMode;
  startRef: string;
  endRef: string;
  anchorEntryId: string;
  originEntryId: string;
  directEntryIds: string[];
  effectiveEntryIds: string[];
  directToolCallIds: string[];
  effectiveToolCallIds: string[];
  consumedBlockIds: number[];
  compressedTokens: number;
  summaryTokens: number;
  createdAt: number;
  summary: string;
}

export interface DcpState {
  version: 1;
  manualMode: boolean;
  nextBlockId: number;
  nextRunId: number;
  blocks: Map<number, CompressionBlock>;
  activeBlockIds: Set<number>;
  totalCompressedTokens: number;
  turnCounter: number;
}

export interface SerializedDcpState {
  version: 1;
  manualMode: boolean;
  nextBlockId: number;
  nextRunId: number;
  blocks: Array<[number, CompressionBlock]>;
  activeBlockIds: number[];
  totalCompressedTokens: number;
  turnCounter: number;
}

export interface ContextFrame {
  ref: string;
  entryId: string;
  message: any;
  tokenCount: number;
  toolCallIds: string[];
  role: string;
}
