import assert from "node:assert/strict";
import test from "node:test";
import { defaultPiExtConfig, mergePiExtConfig } from "../../../src/core/config";
import { createMemoryModule } from "../../../src/modules/memory";

function createHarness(config = defaultPiExtConfig) {
  const handlers = new Map<string, any[]>();
  const tools: string[] = [];
  const migrations: any[] = [];
  const api: any = {
    pi: {
      on(event: string, handler: any) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerTool(def: any) {
        tools.push(def.name);
      },
    },
    getRuntime: () => ({ config, logger: { warn() {}, debug() {}, info() {}, error() {} } }),
    getDatabases: async () => ({
      global: { db: "global-db" },
      project: { db: "project-db" },
    }),
    registerDatabaseMigrations(scope: string, moduleId: string, migrationMap: any) {
      migrations.push({ scope, moduleId, migrationMap });
    },
    isEnabled: () => config.enabled && config.modules.memory.enabled,
    onRuntimeReload() {},
  };
  return { api, handlers, tools, migrations };
}

test("memory module registers migrations and tools", () => {
  const harness = createHarness();
  createMemoryModule().register(harness.api);

  assert(harness.tools.includes("create_global_memory"));
  assert(harness.tools.includes("create_project_memory"));
  assert(harness.tools.includes("create_session_memory"));
  assert(harness.tools.includes("search_memories"));
  assert.equal(harness.migrations.filter((item) => item.moduleId === "memory").length, 2);
});

test("before_agent_start appends formatted memories", async () => {
  const harness = createHarness();
  createMemoryModule({
    listMemoriesForPrompt: async () => ({
      global: [{ id: "g1", scope: "global", content: "Use concise answers.", tags: [], importance: 3, createdAt: "now", updatedAt: "now" }],
      project: [],
      session: [],
    }),
  }).register(harness.api);

  const handler = harness.handlers.get("before_agent_start")![0];
  const result = await handler(
    { systemPrompt: "Base prompt" },
    { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } },
  );

  assert.match(result.systemPrompt, /Base prompt/);
  assert.match(result.systemPrompt, /Use concise answers/);
});

test("before_agent_start skips prompt injection when disabled", async () => {
  const config = mergePiExtConfig(defaultPiExtConfig, { modules: { memory: { prompt: { enabled: false } } } });
  const harness = createHarness(config);
  createMemoryModule({
    listMemoriesForPrompt: async () => { throw new Error("unexpected"); },
  }).register(harness.api);

  const handler = harness.handlers.get("before_agent_start")![0];
  const result = await handler(
    { systemPrompt: "Base prompt" },
    { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } },
  );

  assert.equal(result, undefined);
});
