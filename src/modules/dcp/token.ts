export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: unknown): number {
  return estimateTokens(messageToText(message));
}

export function messageToText(message: unknown): string {
  const msg = message as {
    content?: unknown;
    summary?: unknown;
    command?: unknown;
    output?: unknown;
  };
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content
      .map((part) => {
        const item = part as {
          type?: string;
          text?: string;
          thinking?: string;
          name?: string;
          arguments?: unknown;
          data?: string;
        };
        if (typeof item.text === "string") return item.text;
        if (typeof item.thinking === "string") return item.thinking;
        if (item.type === "toolCall")
          return `${item.name ?? "tool"} ${JSON.stringify(item.arguments ?? {})}`;
        return "";
      })
      .join("\n");
  }
  if (typeof msg?.summary === "string") return msg.summary;
  if (typeof msg?.command === "string" || typeof msg?.output === "string")
    return `${msg.command ?? ""}\n${msg.output ?? ""}`;
  return JSON.stringify(message ?? "");
}
