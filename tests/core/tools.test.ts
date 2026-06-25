import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPiExtConfig, mergePiExtConfig } from "../../src/core/config";
import { reconcileActiveTools } from "../../src/core/tools";

const ownedTools = [
  "compress",
  "run_subagent",
  "get_subagent_result",
  "steer_subagent",
  "create_global_memory",
  "create_project_memory",
  "create_session_memory",
  "search_memories",
];

test("adds owned tools when enabled", () => {
  const next = reconcileActiveTools(["read", "bash"], defaultPiExtConfig);

  assert.deepEqual(new Set(next), new Set(["read", "bash", ...ownedTools]));
});

test("removes owned tools when global config is disabled", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, { enabled: false });
  const next = reconcileActiveTools(["read", "compress", "bash"], config);

  assert.deepEqual(next, ["read", "bash"]);
});

test("removes owned tools when owning module is disabled", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    modules: { dcp: { enabled: false }, agents: { enabled: false }, memory: { enabled: false } },
  });
  const next = reconcileActiveTools(["read", ...ownedTools, "bash"], config);

  assert.deepEqual(next, ["read", "bash"]);
});

test("removes owned tools when individual tool is disabled", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    modules: {
      dcp: { tools: { compress: { enabled: false } } },
      agents: { tools: { runSubagent: { enabled: false }, getSubagentResult: { enabled: false }, steerSubagent: { enabled: false } } },
      memory: {
        tools: {
          createGlobalMemory: { enabled: false },
          createProjectMemory: { enabled: false },
          createSessionMemory: { enabled: false },
          searchMemories: { enabled: false },
        },
      },
    },
  });
  const next = reconcileActiveTools(["read", ...ownedTools, "bash"], config);

  assert.deepEqual(next, ["read", "bash"]);
});

test("preserves unrelated tools while reconciling owned tools", () => {
  const next = reconcileActiveTools(["read", "custom_tool"], defaultPiExtConfig);

  assert.deepEqual(new Set(next), new Set(["read", "custom_tool", ...ownedTools]));
});
