import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentsModule } from "../../../src/modules/agents";
import { defaultPiExtConfig, mergePiExtConfig } from "../../../src/core/config";

function createApi(config = defaultPiExtConfig) {
  const handlers = new Map<string, any>();
  const tools: string[] = [];
  return {
    handlers,
    tools,
    api: {
      pi: {
        on(event: string, handler: any) { handlers.set(event, handler); },
        registerTool(def: any) { tools.push(def.name); },
        sendMessage() {},
        events: { emit() {} },
      },
      getRuntime: () => ({ config, logger: { warn() {}, info() {}, debug() {} } }),
      isEnabled: () => config.enabled && config.modules.agents.enabled,
      getDatabases: async () => ({}),
      registerDatabaseMigrations() {},
      onRuntimeReload() {},
    } as any,
  };
}

test("agents module registers orchestration tools", () => {
  const { api, tools } = createApi();

  createAgentsModule({ agentDir: "/agent" }).register(api);

  assert.deepEqual(new Set(tools), new Set(["run_subagent", "get_subagent_result", "steer_subagent"]));
});

test("agents module appends orchestrator prompt for parent sessions", async () => {
  const { api, handlers } = createApi();
  createAgentsModule({ agentDir: "/agent" }).register(api);

  const result = await handlers.get("before_agent_start")({ systemPrompt: "base" }, { sessionManager: { getSessionId: () => "parent" } });

  assert.match(result.systemPrompt, /base/);
  assert.match(result.systemPrompt, /orchestrator/);
});

test("agents module skips orchestrator prompt when disabled", async () => {
  const config = mergePiExtConfig(defaultPiExtConfig, { modules: { agents: { orchestrator: { enabled: false } } } });
  const { api, handlers } = createApi(config);
  createAgentsModule({ agentDir: "/agent" }).register(api);

  const result = await handlers.get("before_agent_start")({ systemPrompt: "base" }, { sessionManager: { getSessionId: () => "parent" } });

  assert.equal(result, undefined);
});
