import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubagentSessionFactory } from "../../../src/modules/agents/session-factory";
import type { AgentDefinition } from "../../../src/modules/agents/definitions";

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "scout",
    description: "Recon",
    tools: ["read", "run_subagent"],
    systemPrompt: "Scout prompt",
    source: "user",
    filePath: "/agent/agents/scout.md",
    ...overrides,
  };
}

test("creates persistent child sessions with inherited extensions and recursion guard", async () => {
  const calls: any[] = [];
  const session = {
    getActiveToolNames: () => ["read", "run_subagent", "extension_tool"],
    setActiveToolsByName: (names: string[]) => calls.push({ activeTools: names }),
    bindExtensions: async () => calls.push({ bindExtensions: true }),
    sessionId: "child-1",
    sessionFile: "/sessions/parent/tasks/child.jsonl",
  };
  const factory = createSubagentSessionFactory({
    agentDir: "/agent",
    createResourceLoader: (opts) => ({ reload: async () => { calls.push({ loader: opts }); } }),
    createSessionManager: (_cwd, sessionDir) => ({
      newSession: (opts: any) => calls.push({ newSession: opts, sessionDir }),
      getSessionFile: () => "/sessions/parent/tasks/child.jsonl",
      getSessionId: () => "child-1",
    }),
    createSettingsManager: () => ({} as any),
    createSession: async (opts) => {
      calls.push({ session: opts });
      return { session: session as any };
    },
  });

  const created = await factory.create({
    cwd: "/repo",
    agent: agent(),
    parentSessionFile: "/sessions/parent.jsonl",
    parentSessionId: "parent-1",
    parentModel: undefined,
    modelRegistry: { find: () => undefined },
    extensionMode: "inherit-safe",
    recursiveToolDenylist: ["run_subagent", "get_subagent_result", "steer_subagent"],
  });

  assert.equal(created.sessionId, "child-1");
  assert.equal(created.transcriptPath, "/sessions/parent/tasks/child.jsonl");
  assert.equal(calls[0].loader.noExtensions, false);
  assert.equal(calls[0].loader.noPromptTemplates, true);
  assert.deepEqual(calls.find((call) => call.session)?.session.tools, ["read"]);
  assert.deepEqual(calls.find((call) => call.activeTools)?.activeTools, ["read", "extension_tool"]);
});

test("can disable child extension loading", async () => {
  const calls: any[] = [];
  const factory = createSubagentSessionFactory({
    agentDir: "/agent",
    createResourceLoader: (opts) => ({ reload: async () => { calls.push({ loader: opts }); } }),
    createSessionManager: () => ({ newSession: () => {}, getSessionFile: () => undefined, getSessionId: () => "child-1" }),
    createSettingsManager: () => ({} as any),
    createSession: async () => ({ session: { bindExtensions: async () => {}, getActiveToolNames: () => [], setActiveToolsByName: () => {} } as any }),
  });

  await factory.create({
    cwd: "/repo",
    agent: agent({ tools: ["read"] }),
    parentSessionId: "parent-1",
    parentModel: undefined,
    modelRegistry: { find: () => undefined },
    extensionMode: "none",
    recursiveToolDenylist: ["run_subagent"],
  });

  assert.equal(calls[0].loader.noExtensions, true);
});
