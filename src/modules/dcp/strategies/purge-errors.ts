export interface ToolTurnStatus {
  status: "pending" | "running" | "completed" | "error";
  turn: number;
}

export function shouldPurgeErroredToolInput(
  tool: ToolTurnStatus,
  currentTurn: number,
  thresholdTurns: number,
): boolean {
  if (tool.status !== "error") return false;
  return currentTurn - tool.turn >= Math.max(1, thresholdTurns);
}

export const PRUNED_TOOL_ERROR_INPUT_REPLACEMENT =
  "[input removed due to failed tool call]";
