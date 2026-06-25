export type SubagentRunStatus = "queued" | "spawning" | "running" | "completed" | "failed" | "aborted" | "stalled" | "disposed";

export interface SubagentRunRecord {
  id: string;
  agent: string;
  prompt: string;
  status: SubagentRunStatus;
  background: boolean;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  completedAt?: number;
  sessionId?: string;
  sessionDir?: string;
  transcriptPath?: string;
  turnCount: number;
  toolUseCount: number;
  output?: string;
  error?: string;
}

export interface CreateSubagentRunRecordInput {
  agent: string;
  prompt: string;
  background: boolean;
}

export interface SubagentRunStoreDeps {
  now?: () => number;
  id?: () => string;
}

export interface SubagentRunStore {
  create(input: CreateSubagentRunRecordInput): SubagentRunRecord;
  update(id: string, patch: Partial<Omit<SubagentRunRecord, "id" | "createdAt">>): SubagentRunRecord | undefined;
  get(id: string): SubagentRunRecord | undefined;
  list(): SubagentRunRecord[];
}

export function createSubagentRunStore(deps: SubagentRunStoreDeps = {}): SubagentRunStore {
  const now = deps.now ?? (() => Date.now());
  const id = deps.id ?? createDefaultTaskId;
  const records = new Map<string, SubagentRunRecord>();

  return {
    create(input) {
      const timestamp = now();
      const record: SubagentRunRecord = {
        id: id(),
        agent: input.agent,
        prompt: input.prompt,
        status: "queued",
        background: input.background,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
        turnCount: 0,
        toolUseCount: 0,
      };
      records.set(record.id, record);
      return { ...record };
    },
    update(recordId, patch) {
      const current = records.get(recordId);
      if (!current) return undefined;
      Object.assign(current, patch, { updatedAt: now() });
      return { ...current };
    },
    get(recordId) {
      const current = records.get(recordId);
      return current ? { ...current } : undefined;
    },
    list() {
      return [...records.values()].map((record) => ({ ...record })).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    },
  };
}

function createDefaultTaskId(): string {
  return `subagent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
