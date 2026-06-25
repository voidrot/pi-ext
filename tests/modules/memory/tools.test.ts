import assert from "node:assert/strict";
import test from "node:test";
import { registerMemoryTools } from "../../../src/modules/memory/tools";

function createPiCapture() {
  const tools = new Map<string, any>();
  return {
    pi: { registerTool(def: any) { tools.set(def.name, def); } },
    tools,
  };
}

const ctx: any = {
  cwd: "/repo",
  sessionManager: { getSessionId: () => "session-1" },
};

function register(overrides: {
  getDatabases?: any;
  createGlobalMemory?: any;
  createProjectMemory?: any;
  searchMemoriesByText?: any;
  enqueueVectorWork?: any;
  embedText?: any;
} = {}) {
  const { pi, tools } = createPiCapture();
  registerMemoryTools(pi as any, {
    isEnabled: () => true,
    getDatabases: overrides.getDatabases ?? (async () => ({ global: { db: "global-db" } })),
    createGlobalMemory: overrides.createGlobalMemory ?? (async () => { throw new Error("unexpected global create"); }),
    createProjectMemory: overrides.createProjectMemory ?? (async () => { throw new Error("unexpected project create"); }),
    searchMemoriesByText: overrides.searchMemoriesByText ?? (async () => { throw new Error("unexpected search"); }),
    enqueueVectorWork: overrides.enqueueVectorWork,
    embedText: overrides.embedText,
  } as any);
  return { pi, tools };
}

test("create_global_memory stores a global memory", async () => {
  const calls: any[] = [];
  const { tools } = register({
    createGlobalMemory: async (_db: any, input: any) => {
      calls.push(input);
      return { id: "g1", scope: "global", content: input.content, tags: input.tags ?? [], importance: input.importance ?? 3, createdAt: "now", updatedAt: "now" };
    },
  });

  const result = await tools.get("create_global_memory").execute("id", { content: "Remember this", tags: ["a"], importance: 4 }, undefined, undefined, ctx);

  assert.deepEqual(calls[0], { content: "Remember this", tags: ["a"], importance: 4 });
  assert.match(result.content[0].text, /Created global memory g1/);
});

test("create_project_memory requires a project database", async () => {
  const { tools } = register();

  const result = await tools.get("create_project_memory").execute("id", { content: "Project fact" }, undefined, undefined, ctx);

  assert.match(result.content[0].text, /Project memories require a trusted project/);
});

test("search_memories searches all available memory scopes", async () => {
  const calls: any[] = [];
  const { tools } = register({
    getDatabases: async () => ({ global: { db: "global-db" }, project: { db: "project-db" } }),
    searchMemoriesByText: async (_handles: any, options: any) => {
      calls.push(options);
      return [
        {
          id: "m1",
          scope: "global",
          content: "Use pnpm as the package manager.",
          tags: ["tooling"],
          importance: 3,
          createdAt: "now",
          updatedAt: "now",
          distance: 0.12,
        },
      ];
    },
  });

  const result = await tools.get("search_memories").execute("id", { query: "pnpm", limit: 5 }, undefined, undefined, ctx);

  assert.equal(calls[0].query, "pnpm");
  assert.equal(calls[0].limit, 5);
  assert.equal(calls[0].sessionId, "session-1");
  assert.equal(calls[0].scopes, undefined);
  assert(calls[0].embedding instanceof Float32Array);
  assert.match(result.content[0].text, /m1/);
  assert.match(result.content[0].text, /distance=0.12/);
});

test("create_global_memory queues vector work without awaiting it", async () => {
  const calls: any[] = [];
  let resolveEnqueue: (() => void) | undefined;
  const enqueueStarted = new Promise<void>((resolve) => { resolveEnqueue = resolve; });
  const { tools } = register({
    getDatabases: async () => ({ global: { db: "global-db" } }),
    createGlobalMemory: async (_db: any, input: any) => ({ id: "g1", scope: "global", content: input.content, tags: [], importance: 3, createdAt: "now", updatedAt: "now" }),
    enqueueVectorWork: () => {
      calls.push("enqueue");
      resolveEnqueue?.();
    },
  });

  const result = await tools.get("create_global_memory").execute("id", { content: "Remember this" }, undefined, undefined, ctx);
  await enqueueStarted;

  assert.deepEqual(calls, ["enqueue"]);
  assert.match(result.content[0].text, /Vector indexing has been queued/);
});

test("create_session_memory stores session id", async () => {
  let input: any;
  const { tools } = register({
    getDatabases: async () => ({ global: { db: "global-db" }, project: { db: "project-db" } }),
    createProjectMemory: async (_db: any, value: any) => {
      input = value;
      return { id: "s1", scope: "session", content: value.content, tags: [], importance: 3, createdAt: "now", updatedAt: "now", sessionId: value.sessionId };
    },
  });

  const result = await tools.get("create_session_memory").execute("id", { content: "Session fact" }, undefined, undefined, ctx);

  assert.equal(input.scope, "session");
  assert.equal(input.sessionId, "session-1");
  assert.match(result.content[0].text, /Created session memory s1/);
});
