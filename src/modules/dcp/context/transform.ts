import { defaultConfig, resolveLimit, type DcpConfig } from "../config";
import { formatBlockRef, formatMessageIdTag } from "../message-ids";
import { CONTEXT_LIMIT_NUDGE } from "../prompts";
import type { ContextFrame, DcpState } from "../state/types";
import {
  appendTextToMessage,
  createSyntheticSummaryMessage,
  sanitizeMessage,
} from "../pi/messages";
import { assignFrameTurns } from "../retention/age";
import { applyCompressedBlockRetention } from "../retention/compressed-blocks";
import { getStaleToolCallIds, stripStaleToolArtifacts } from "../retention/stale-tools";

export interface TransformContextInput {
  messages: any[];
  frames: ContextFrame[];
  state: DcpState;
  usageTokens: number | null;
  config?: DcpConfig;
  contextWindow?: number;
}

export function transformMessagesForContext(input: TransformContextInput): {
  messages: any[];
} {
  const config = input.config ?? defaultConfig;
  assignFrameTurns(input.state, input.frames, input.state.turnCounter);
  const staleToolCallIds = getStaleToolCallIds(input.state, input.state.turnCounter, config);
  applyCompressedBlockRetention(input.state, input.frames, staleToolCallIds, config);
  const activeBlocks = Array.from(input.state.activeBlockIds)
    .map((id) => input.state.blocks.get(id))
    .filter(
      (block): block is NonNullable<typeof block> => !!block && block.active,
    );
  const compressedEntryIds = new Set(
    activeBlocks.flatMap((block) => block.effectiveEntryIds),
  );
  const blockByAnchor = new Map(
    activeBlocks.map((block) => [block.anchorEntryId, block]),
  );
  const transformed: any[] = [];

  for (const frame of input.frames) {
    const block = blockByAnchor.get(frame.entryId);
    if (block) {
      transformed.push(
        createSyntheticSummaryMessage(
          `[Compressed conversation section]\n${block.summary}\n\n${formatMessageIdTag(formatBlockRef(block.blockId)).trim()}`,
          Date.now(),
        ),
      );
    }
    if (compressedEntryIds.has(frame.entryId)) continue;
    const stripped = stripStaleToolArtifacts(frame.message, staleToolCallIds);
    if (!stripped) continue;
    const message = sanitizeMessage(stripped);
    appendTextToMessage(message, formatMessageIdTag(frame.ref));
    transformed.push(message);
  }

  maybeInjectNudge(transformed, input.usageTokens, input.contextWindow, config);
  return { messages: transformed };
}

function maybeInjectNudge(
  messages: any[],
  usageTokens: number | null,
  contextWindow: number | undefined,
  config: DcpConfig,
): void {
  if (usageTokens === null) return;
  const min = resolveLimit(config.compress.minContextLimit, contextWindow);
  if (min > 0 && usageTokens < min) return;
  const latestUser = [...messages]
    .reverse()
    .find((message) => message?.role === "user");
  if (latestUser) appendTextToMessage(latestUser, CONTEXT_LIMIT_NUDGE);
}
