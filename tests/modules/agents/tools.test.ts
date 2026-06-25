import assert from "node:assert/strict";
import { test } from "node:test";
import { registerAgentTools } from "../../../src/modules/agents/tools";

function createPiCapture() {
  const tools = new Map<string, any>();
  return {
    pi: { registerTool(def: any) { tools.set(def.name, def); } },
    tools,
  };
}

const ctx: any = {
  cwd: "/repo",
  model: undefined,
  modelRegistry: { find: () => undefined },
  sessionManager: { getSessionFile: () => "/sessions/parent.jsonl", getSessionId: () => "parent-1" },
};

test("run_subagent rejects unknown agents with catalog", async () => {
  const { pi, tools } = createPiCapture();
  registerAgentTools(pi as any, {
    isEnabled: () => true,
    discover: () => ({ agents: [{ name: "scout", description: "Recon", tools: ["read"], systemPrompt: "", source: "user", filePath: "/a" }], diagnostics: [], agentsDir: "/agent/agents" }),
    manager: { runForeground: async () => { throw new Error("unexpected"); }, startBackground: async () => { throw new Error("unexpected"); }, get: () => undefined, list: () => [], steer: async () => {} } as any,
    getConfig: () => ({ maxParallel: 4 }),
  });

  const result = await tools.get("run_subagent").execute("id", { agent: "missing", prompt: "x" }, undefined, undefined, ctx);

  assert.match(result.content[0].text, /Unknown agent/);
  assert.match(result.content[0].text, /scout/);
});

test("run_subagent starts background runs and returns task ids", async () => {
  const { pi, tools } = createPiCapture();
  registerAgentTools(pi as any, {
    isEnabled: () => true,
    discover: () => ({ agents: [{ name: "scout", description: "Recon", tools: ["read"], systemPrompt: "", source: "user", filePath: "/a" }], diagnostics: [], agentsDir: "/agent/agents" }),
    manager: {
      startBackground: async () => ({ id: "task-1", agent: "scout", prompt: "x", status: "queued", background: true, createdAt: 0, updatedAt: 0, lastActivityAt: 0, turnCount: 0, toolUseCount: 0 }),
    } as any,
    getConfig: () => ({ maxParallel: 4 }),
  });

  const result = await tools.get("run_subagent").execute("id", { agent: "scout", prompt: "x", background: true }, undefined, undefined, ctx);

  assert.match(result.content[0].text, /task-1/);
  assert.match(result.content[0].text, /started in background/);
});

test("get_subagent_result returns stored output", async () => {
  const { pi, tools } = createPiCapture();
  registerAgentTools(pi as any, {
    isEnabled: () => true,
    discover: () => ({ agents: [], diagnostics: [], agentsDir: "/agent/agents" }),
    manager: { get: () => ({ id: "task-1", agent: "scout", prompt: "x", status: "completed", output: "done", background: true, createdAt: 0, updatedAt: 0, lastActivityAt: 0, turnCount: 1, toolUseCount: 0 }) } as any,
    getConfig: () => ({ maxParallel: 4 }),
  });

  const result = await tools.get("get_subagent_result").execute("id", { taskId: "task-1" }, undefined, undefined, ctx);

  assert.match(result.content[0].text, /done/);
});

 test("steer_subagent forwards steer messages", async () => {
  const { pi, tools } = createPiCapture();
  let steered = "";
  registerAgentTools(pi as any, {
    isEnabled: () => true,
    discover: () => ({ agents: [], diagnostics: [], agentsDir: "/agent/agents" }),
    manager: { steer: async (_taskId: string, message: string) => { steered = message; } } as any,
    getConfig: () => ({ maxParallel: 4 }),
  });

  const result = await tools.get("steer_subagent").execute("id", { taskId: "task-1", message: "wrap up" }, undefined, undefined, ctx);

  assert.equal(steered, "wrap up");
  assert.match(result.content[0].text, /Steered/);
});
