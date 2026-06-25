import type { MemoryRecord, PromptMemoryList } from "../memory/repository";

export type DashboardMemoryScope = "combined" | "global" | "project" | "session";

export type DashboardMemoryRecord = MemoryRecord;

export interface DashboardMemoriesPayload {
  selectedScope: DashboardMemoryScope;
  counts: Record<DashboardMemoryScope, number>;
  memories: PromptMemoryList;
  visibleMemories: DashboardMemoryRecord[];
}

export interface CreateDashboardMemoriesPayloadInput {
  selectedScope?: string;
  memories: PromptMemoryList;
}

const dashboardMemoryScopes = new Set<DashboardMemoryScope>(["combined", "global", "project", "session"]);

export function selectDashboardMemoryScope(value: string | undefined): DashboardMemoryScope {
  return value && dashboardMemoryScopes.has(value as DashboardMemoryScope) ? (value as DashboardMemoryScope) : "combined";
}

export function createDashboardMemoriesPayload(input: CreateDashboardMemoriesPayloadInput): DashboardMemoriesPayload {
  const selectedScope = selectDashboardMemoryScope(input.selectedScope);
  const memories = cloneMemories(input.memories);
  const combined = [...memories.global, ...memories.project, ...memories.session].toSorted(compareMemoryNewestFirst);
  const visibleMemories = selectedScope === "combined" ? combined : memories[selectedScope];

  return {
    selectedScope,
    counts: {
      combined: combined.length,
      global: memories.global.length,
      project: memories.project.length,
      session: memories.session.length,
    },
    memories,
    visibleMemories,
  };
}

function cloneMemories(memories: PromptMemoryList): PromptMemoryList {
  return {
    global: memories.global.map(cloneMemory),
    project: memories.project.map(cloneMemory),
    session: memories.session.map(cloneMemory),
  };
}

function cloneMemory(memory: MemoryRecord): DashboardMemoryRecord {
  return {
    id: memory.id,
    scope: memory.scope,
    content: memory.content,
    ...(memory.title ? { title: memory.title } : {}),
    tags: [...memory.tags],
    importance: memory.importance,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    ...(memory.sessionId ? { sessionId: memory.sessionId } : {}),
  };
}

function compareMemoryNewestFirst(left: DashboardMemoryRecord, right: DashboardMemoryRecord): number {
  const rightTime = Date.parse(right.createdAt);
  const leftTime = Date.parse(left.createdAt);
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) return rightTime - leftTime;
  if (right.importance !== left.importance) return right.importance - left.importance;
  return left.id.localeCompare(right.id);
}
