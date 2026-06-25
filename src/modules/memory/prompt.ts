import type { MemoryRecord, PromptMemoryList } from "./repository";

export interface MemoryPromptOptions {
  maxContentChars: number;
}

export function formatMemoryPrompt(memories: PromptMemoryList, options: MemoryPromptOptions): string {
  const sections = [
    formatSection("Global memories", memories.global, options),
    formatSection("Project memories", memories.project, options),
    formatSection("Session memories", memories.session, options),
  ].filter(Boolean);

  if (sections.length === 0) return "";

  return [
    "Relevant saved memories are available. Treat them as user/project/session preferences and facts, but do not mention them unless relevant.",
    ...sections,
  ].join("\n\n");
}

function formatSection(title: string, memories: MemoryRecord[], options: MemoryPromptOptions): string {
  if (memories.length === 0) return "";
  const lines = memories.map((memory) => {
    const label = memory.title ? `${memory.title}: ` : "";
    const tags = memory.tags.length > 0 ? ` [tags: ${memory.tags.join(", ")}]` : "";
    return `- (${memory.id}, importance ${memory.importance}) ${label}${truncate(memory.content, options.maxContentChars)}${tags}`;
  });
  return [`${title}:`, ...lines].join("\n");
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + "…";
}
