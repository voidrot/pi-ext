import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubagentRunManager } from "../../../src/modules/agents/run-manager";
import type { AgentDefinition } from "../../../src/modules/agents/definitions";

function fakeAgent(): AgentDefinition {
  return { name: "scout", description: "Recon", tools: ["read"], systemPrompt: "Scout", source: "user", filePath: "/agent/agents/scout.md" };
}

function fakeSession(text = "done") {
  const listeners = new Set<(event: any) => void>();
  return {
    sessionId: "child-1",
    sessionFile: "/tmp/child.jsonl",
    messages: [{ role: "assistant", content: [{ type: "text", text }] }],
    subscribe(fn: (event: any) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async prompt() {
      listeners.forEach((fn) => fn({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } }));
      listeners.forEach((fn) => fn({ type: "turn_end" }));
    },
    async steer(message: string) {
      listeners.forEach((fn) => fn({ type: "steered", message }));
    },
    async abort() {},
    dispose() {},
  };
}

test("runs foreground subagents and records completion", async () => {
  const notifications: any[] = [];
  const manager = createSubagentRunManager({
    config: { maxParallel: 4, stall: { enabled: false, timeoutMs: 1000, notify: true } },
    resolveAgent: () => fakeAgent(),
    sessionFactory: { create: async () => ({ session: fakeSession("child result") as any, sessionId: "child-1", transcriptPath: "/tmp/child.jsonl", sessionDir: "/tmp" }) },
    lifecycle: { emit: () => {} },
    notify: (record) => notifications.push(record),
    now: () => Date.now(),
  });

  const result = await manager.runForeground({ agent: "scout", prompt: "Find auth", cwd: "/repo", background: false });

  assert.equal(result.status, "completed");
  assert.equal(result.output, "child result");
  assert.equal(result.transcriptPath, "/tmp/child.jsonl");
  assert.equal(notifications.length, 0);
});

test("background subagents return immediately and notify on completion", async () => {
  const notifications: any[] = [];
  const manager = createSubagentRunManager({
    config: { maxParallel: 4, stall: { enabled: false, timeoutMs: 1000, notify: true } },
    resolveAgent: () => fakeAgent(),
    sessionFactory: { create: async () => ({ session: fakeSession("done") as any, sessionId: "child-1", transcriptPath: "/tmp/child.jsonl", sessionDir: "/tmp" }) },
    lifecycle: { emit: () => {} },
    notify: (record) => notifications.push(record),
    now: () => Date.now(),
  });

  const record = await manager.startBackground({ agent: "scout", prompt: "Find auth", cwd: "/repo", background: true });
  await manager.waitFor(record.id);

  assert.equal(record.status, "queued");
  assert.equal(manager.get(record.id)?.status, "completed");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].status, "completed");
});

test("steers live background subagents", async () => {
  let steered = "";
  const session = fakeSession("done") as any;
  session.prompt = async () => new Promise(() => {});
  session.steer = async (message: string) => { steered = message; };
  const manager = createSubagentRunManager({
    config: { maxParallel: 4, stall: { enabled: false, timeoutMs: 1000, notify: true } },
    resolveAgent: () => fakeAgent(),
    sessionFactory: { create: async () => ({ session, sessionId: "child-1", transcriptPath: "/tmp/child.jsonl", sessionDir: "/tmp" }) },
    lifecycle: { emit: () => {} },
    notify: () => {},
    now: () => Date.now(),
  });

  const record = await manager.startBackground({ agent: "scout", prompt: "Find auth", cwd: "/repo", background: true });
  await new Promise((resolve) => setImmediate(resolve));
  await manager.steer(record.id, "wrap up");

  assert.equal(steered, "wrap up");
});
