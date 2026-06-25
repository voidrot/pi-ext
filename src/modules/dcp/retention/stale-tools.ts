import type { DcpConfig } from "../config";
import { cloneMessage } from "../pi/messages";
import type { DcpState } from "../state/types";

export function getStaleToolCallIds(state: DcpState, currentTurn: number, config: DcpConfig): Set<string> {
  const stale = new Set<string>();
  if (!config.strategies.staleToolCalls.enabled) return stale;

  const protectedTools = new Set(config.strategies.staleToolCalls.protectedTools);
  const threshold = Math.max(1, config.strategies.staleToolCalls.turns);

  for (const record of state.toolCalls.values()) {
    if (protectedTools.has(record.toolName)) continue;
    if (currentTurn - record.turn >= threshold) stale.add(record.id);
  }

  return stale;
}

export function stripStaleToolArtifacts<T>(message: T, staleToolCallIds: Set<string>): T | undefined {
  const next: any = cloneMessage(message);

  if (next?.role === "toolResult" && staleToolCallIds.has(String(next.toolCallId))) {
    return undefined;
  }

  if (next?.role === "assistant" && Array.isArray(next.content)) {
    next.content = next.content.filter((part: any) => {
      return !(part?.type === "toolCall" && staleToolCallIds.has(String(part.id)));
    });
    if (next.content.length === 0) return undefined;
  }

  return next as T;
}
