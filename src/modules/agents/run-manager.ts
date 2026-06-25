import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentsChildExtensionMode } from "../../core/config";
import type { AgentDefinition } from "./definitions";
import type { AgentsLifecyclePublisher } from "./lifecycle";
import { createSubagentRunStore, type SubagentRunRecord, type SubagentRunStore } from "./records";
import type { CreatedSubagentSession, SubagentSessionFactory } from "./session-factory";

export interface RunManagerConfig {
  maxParallel: number;
  childExtensions?: {
    mode: AgentsChildExtensionMode;
    recursiveToolDenylist: string[];
  };
  stall: {
    enabled: boolean;
    timeoutMs: number;
    notify: boolean;
    abortAfterMs?: number;
  };
}

export interface RunSubagentRequest {
  agent: string;
  prompt: string;
  cwd: string;
  background: boolean;
  parentModel?: unknown;
  modelRegistry?: { find(provider: string, modelId: string): unknown };
  parentSessionFile?: string;
  parentSessionId?: string;
  signal?: AbortSignal;
  onTextDelta?: (delta: string, record: SubagentRunRecord) => void;
}

export interface SubagentRunManagerDeps {
  config: RunManagerConfig;
  resolveAgent(name: string): AgentDefinition | undefined;
  sessionFactory: SubagentSessionFactory;
  lifecycle: { emit?: (channel: string, data: unknown) => void } | AgentsLifecyclePublisher;
  notify(record: SubagentRunRecord): void;
  store?: SubagentRunStore;
  now?: () => number;
}

export interface SubagentRunManager {
  runForeground(request: RunSubagentRequest): Promise<SubagentRunRecord>;
  startBackground(request: RunSubagentRequest): Promise<SubagentRunRecord>;
  waitFor(taskId: string): Promise<SubagentRunRecord | undefined>;
  get(taskId: string): SubagentRunRecord | undefined;
  list(): SubagentRunRecord[];
  steer(taskId: string, message: string): Promise<void>;
}

export function createSubagentRunManager(deps: SubagentRunManagerDeps): SubagentRunManager {
  const now = deps.now ?? (() => Date.now());
  const store = deps.store ?? createSubagentRunStore({ now });
  const activeSessions = new Map<string, AgentSession>();
  const promises = new Map<string, Promise<SubagentRunRecord | undefined>>();

  const run = async (request: RunSubagentRequest, record: SubagentRunRecord): Promise<SubagentRunRecord | undefined> => {
    const agent = deps.resolveAgent(request.agent);
    if (!agent) {
      store.update(record.id, { status: "failed", error: `Unknown agent: ${request.agent}`, completedAt: now() });
      return store.get(record.id);
    }

    let created: CreatedSubagentSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let text = "";
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const touch = () => store.update(record.id, { lastActivityAt: now() });
    const resetStallTimer = () => {
      if (!deps.config.stall.enabled) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        const current = store.get(record.id);
        if (!current || !["running", "spawning"].includes(current.status)) return;
        const stalled = store.update(record.id, { status: "stalled", error: `No activity for ${deps.config.stall.timeoutMs}ms` });
        if (!stalled) return;
        emitLifecycle("stalled", stalled, { idleMs: now() - stalled.lastActivityAt });
        if (stalled.background && deps.config.stall.notify) deps.notify(stalled);
      }, deps.config.stall.timeoutMs);
      stallTimer.unref?.();
    };

    try {
      store.update(record.id, { status: "spawning" });
      emitLifecycle("spawning", store.get(record.id));
      created = await deps.sessionFactory.create({
        cwd: request.cwd,
        agent,
        parentSessionFile: request.parentSessionFile,
        parentSessionId: request.parentSessionId,
        parentModel: request.parentModel,
        modelRegistry: request.modelRegistry,
        extensionMode: agent.extensionMode ?? deps.config.childExtensions?.mode ?? "inherit-safe",
        recursiveToolDenylist: deps.config.childExtensions?.recursiveToolDenylist ?? ["run_subagent", "get_subagent_result", "steer_subagent"],
      });
      activeSessions.set(record.id, created.session);
      store.update(record.id, {
        status: "running",
        sessionId: created.sessionId,
        sessionDir: created.sessionDir,
        transcriptPath: created.transcriptPath,
      });
      emitLifecycle("sessionCreated", store.get(record.id));
      emitLifecycle("running", store.get(record.id));

      unsubscribe = created.session.subscribe((event: AgentSessionEvent) => {
        touch();
        resetStallTimer();
        const current = store.get(record.id);
        if (!current) return;
        if (event.type === "message_start") text = "";
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          text += event.assistantMessageEvent.delta;
          const updated = store.update(record.id, { output: text });
          if (updated) request.onTextDelta?.(event.assistantMessageEvent.delta, updated);
          emitLifecycle("progress", updated);
        }
        if (event.type === "turn_end") {
          const nextTurns = current.turnCount + 1;
          store.update(record.id, { turnCount: nextTurns });
          if (agent.maxTurns && nextTurns >= agent.maxTurns) void created?.session.steer("You have reached your turn limit. Wrap up immediately.");
        }
        if (event.type.includes("tool")) store.update(record.id, { toolUseCount: current.toolUseCount + 1 });
      });

      const abort = () => void created?.session.abort();
      request.signal?.addEventListener("abort", abort, { once: true });
      resetStallTimer();
      try {
        await created.session.prompt(request.prompt);
      } finally {
        request.signal?.removeEventListener("abort", abort);
      }
      const output = (text.trim() || getLastAssistantText(created.session)).trim();
      const completed = store.update(record.id, { status: "completed", output, completedAt: now() });
      emitLifecycle("completed", completed);
      if (completed?.background) deps.notify(completed);
      return completed;
    } catch (error) {
      const failed = store.update(record.id, { status: request.signal?.aborted ? "aborted" : "failed", error: String(error), completedAt: now() });
      emitLifecycle(request.signal?.aborted ? "aborted" : "failed", failed);
      if (failed?.background) deps.notify(failed);
      return failed;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      unsubscribe?.();
      activeSessions.delete(record.id);
      created?.session.dispose?.();
      const disposed = store.get(record.id);
      emitLifecycle("disposed", disposed);
    }
  };

  return {
    async runForeground(request) {
      const record = store.create({ agent: request.agent, prompt: request.prompt, background: false });
      const result = await run(request, record);
      return result ?? record;
    },
    async startBackground(request) {
      const record = store.create({ agent: request.agent, prompt: request.prompt, background: true });
      const promise = run({ ...request, background: true }, record);
      promises.set(record.id, promise);
      void promise.finally(() => promises.delete(record.id));
      return record;
    },
    async waitFor(taskId) {
      return (await promises.get(taskId)) ?? store.get(taskId);
    },
    get(taskId) {
      return store.get(taskId);
    },
    list() {
      return store.list();
    },
    async steer(taskId, message) {
      const session = activeSessions.get(taskId);
      if (!session) throw new Error(`Subagent task is not running: ${taskId}`);
      await session.steer(message);
    },
  };

  function emitLifecycle(kind: keyof AgentsLifecyclePublisher, record: SubagentRunRecord | undefined, extra: Record<string, unknown> = {}): void {
    if (!record) return;
    const lifecycle = deps.lifecycle as Partial<AgentsLifecyclePublisher>;
    const fn = lifecycle[kind];
    if (typeof fn === "function") {
      fn.call(lifecycle, {
        taskId: record.id,
        agentName: record.agent,
        status: record.status,
        sessionId: record.sessionId,
        transcriptPath: record.transcriptPath,
        output: record.output,
        error: record.error,
        ...extra,
      });
    }
  }
}

function getLastAssistantText(session: Pick<AgentSession, "messages">): string {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message.role !== "assistant") continue;
    const text = extractText(message.content).trim();
    if (text) return text;
  }
  return "";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => typeof item === "object" && item && "text" in item ? String((item as { text?: unknown }).text ?? "") : "").join("");
}
