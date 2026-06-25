import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeManager } from "../../src/core/runtime";

function createPiMock(activeTools: string[] = ["read"]): any {
  return {
    activeTools: [...activeTools],
    setActiveToolsCalls: [] as string[][],
    getActiveTools() {
      return this.activeTools;
    },
    setActiveTools(next: string[]) {
      this.activeTools = next;
      this.setActiveToolsCalls.push(next);
    },
  };
}

function createCtx(cwd: string, trusted: boolean, sessionFile = "session.jsonl"): any {
  return {
    cwd,
    isProjectTrusted: () => trusted,
    sessionManager: { getSessionFile: () => sessionFile },
  };
}

test("loads runtime config and syncs active tools", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-runtime-"));
  const pi = createPiMock(["read"]);
  const manager = createRuntimeManager(pi, { agentDir: join(root, "agent") });

  const runtime = manager.load(createCtx(root, false));

  assert.equal(runtime.config.enabled, true);
  assert.deepEqual(new Set(pi.activeTools), new Set(["read", "compress", "run_subagent", "get_subagent_result", "steer_subagent"]));
});

test("reload reads changed config and removes disabled owned tool", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-runtime-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  const pi = createPiMock(["read", "compress", "custom"]);
  const manager = createRuntimeManager(pi, { agentDir });

  manager.load(createCtx(root, false));
  await writeFile(
    join(agentDir, "pi-ext.json"),
    JSON.stringify({
      modules: {
        dcp: { tools: { compress: { enabled: false } } },
        agents: { enabled: false },
      },
    }),
  );
  const runtime = manager.reload(createCtx(root, false));

  assert.equal(runtime.config.modules.dcp.tools.compress.enabled, false);
  assert.equal(runtime.config.modules.agents.enabled, false);
  assert.deepEqual(pi.activeTools, ["read", "custom"]);
});

test("reload notifies subscribers with the refreshed config", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-runtime-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  const pi = createPiMock(["read"]);
  const manager = createRuntimeManager(pi, { agentDir });
  const seen: unknown[] = [];

  manager.load(createCtx(root, false));
  manager.onReload((runtime) => {
    seen.push((runtime.config.modules.dcp.config.ui as any)?.compressedBlocksWidget);
  });
  await writeFile(join(agentDir, "pi-ext.json"), JSON.stringify({ dcp: { ui: { compressedBlocksWidget: false } } }));
  manager.reload(createCtx(root, false));

  assert.deepEqual(seen, [false]);
});

test("reloads when session file changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-runtime-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  const pi = createPiMock(["read"]);
  const manager = createRuntimeManager(pi, { agentDir });

  const first = manager.load(createCtx(root, false, "one.jsonl"));
  await writeFile(join(agentDir, "pi-ext.json"), JSON.stringify({ debug: true }));
  const second = manager.load(createCtx(root, false, "two.jsonl"));

  assert.notEqual(first, second);
  assert.equal(second.config.debug, true);
});
