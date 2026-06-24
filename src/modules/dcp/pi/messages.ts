import { messageToText } from "../token";

const DCP_PAIRED_TAG_REGEX = /<dcp[^>]*>[\s\S]*?<\/dcp[^>]*>/gi;
const DCP_UNPAIRED_TAG_REGEX = /<\/?dcp[^>]*>/gi;

export function cloneMessage<T>(message: T): T {
  return typeof globalThis.structuredClone === "function"
    ? structuredClone(message)
    : (JSON.parse(JSON.stringify(message)) as T);
}

export function stripDcpTags(text: string): string {
  return text
    .replace(DCP_PAIRED_TAG_REGEX, "")
    .replace(DCP_UNPAIRED_TAG_REGEX, "");
}

export function appendTextToMessage(message: any, text: string): any {
  if (!text.trim()) return message;
  if (typeof message.content === "string") {
    if (!message.content.includes(text.trim()))
      message.content = `${message.content.replace(/\n*$/, "")}\n\n${text.trimStart()}`;
    return message;
  }
  if (Array.isArray(message.content)) {
    for (let i = message.content.length - 1; i >= 0; i--) {
      const part = message.content[i];
      if (part?.type === "text" && typeof part.text === "string") {
        if (!part.text.includes(text.trim()))
          part.text = `${part.text.replace(/\n*$/, "")}\n\n${text.trimStart()}`;
        return message;
      }
    }
    message.content.push({ type: "text", text: text.trimStart() });
    return message;
  }
  message.content = text.trimStart();
  return message;
}

export function sanitizeMessage(message: any): any {
  if (typeof message.content === "string")
    message.content = stripDcpTags(message.content);
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string")
        part.text = stripDcpTags(part.text);
      if (part?.type === "thinking" && typeof part.thinking === "string")
        part.thinking = stripDcpTags(part.thinking);
    }
  }
  return message;
}

export function createSyntheticSummaryMessage(
  summary: string,
  timestamp = Date.now(),
): any {
  return { role: "user", content: summary, timestamp };
}

export function extractToolCallIds(message: any): string[] {
  const ids: string[] = [];
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (part?.type === "toolCall" && typeof part.id === "string")
        ids.push(part.id);
    }
  }
  if (message?.role === "toolResult" && typeof message.toolCallId === "string")
    ids.push(message.toolCallId);
  return [...new Set(ids)];
}

export function stableMessageKey(message: any): string {
  return `${message?.role ?? ""}:${message?.timestamp ?? ""}:${messageToText(message).slice(0, 200)}`;
}
