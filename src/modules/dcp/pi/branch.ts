import { formatMessageRef } from "../message-ids";
import { estimateMessageTokens } from "../token";
import type { ContextFrame } from "../state/types";
import { extractToolCallIds, stableMessageKey } from "./messages";

export function createFramesFromMessages(
  messages: any[],
  branchEntries: any[] = [],
): ContextFrame[] {
  const messageEntries = branchEntries.filter(
    (entry) => entry?.type === "message" && entry.message,
  );
  const unusedEntries = [...messageEntries];
  return messages.map((message, index) => {
    const entry = findMatchingEntry(message, unusedEntries) ?? {
      id: `context-${index + 1}`,
      message,
    };
    const usedIndex = unusedEntries.indexOf(entry);
    if (usedIndex >= 0) unusedEntries.splice(usedIndex, 1);
    return {
      ref: formatMessageRef(index + 1),
      entryId: String(entry.id),
      message,
      tokenCount: estimateMessageTokens(message),
      toolCallIds: extractToolCallIds(message),
      role: String(message?.role ?? "unknown"),
    };
  });
}

function findMatchingEntry(message: any, entries: any[]): any | undefined {
  let found = entries.find((entry) => entry.message === message);
  if (found) return found;
  if (
    message?.role === "toolResult" &&
    typeof message.toolCallId === "string"
  ) {
    found = entries.find(
      (entry) =>
        entry.message?.role === "toolResult" &&
        entry.message.toolCallId === message.toolCallId,
    );
    if (found) return found;
  }
  const key = stableMessageKey(message);
  return entries.find((entry) => stableMessageKey(entry.message) === key);
}
