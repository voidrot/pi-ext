import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";
import { registerMemoryDatabaseMigrations } from "../../../src/modules/memory/models";
import { createGlobalMemory, searchMemoriesByText } from "../../../src/modules/memory/repository";
import { MemoryVectorBackgroundWorker } from "../../../src/modules/memory/vector-worker";

function createCtx(cwd: string): any {
  return { cwd, isProjectTrusted: () => true };
}

async function createHandles() {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-memory-worker-"));
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  registerMemoryDatabaseMigrations(registry);
  const manager = new DatabaseManager({ agentDir: join(root, "home", ".pi", "agent"), registry });
  const ctx = createCtx(join(root, "project"));
  const handles = await manager.ensureInitialized(ctx);
  return { manager, handles, ctx };
}

test("background worker stores queued memory vectors", async () => {
  const { manager, handles, ctx } = await createHandles();
  const memory = await createGlobalMemory(handles.global.db, { content: "Use pnpm for JavaScript package management." });
  const calls: string[] = [];
  const worker = new MemoryVectorBackgroundWorker({
    getBatchSize: () => 10,
    getProvider: () => ({
      name: "test-provider",
      model: "test-model",
      dimensions: 256,
      async embed(text: string) {
        calls.push(text);
        const vector = new Float32Array(256);
        vector[0] = 1;
        return vector;
      },
    }),
  });

  worker.enqueue(ctx, handles);
  await worker.flush(ctx, handles);

  assert.equal(calls.length, 1);
  const results = await searchMemoriesByText(handles, { query: "anything", embedding: calls.length ? new Float32Array([1, ...Array(255).fill(0)]) : undefined, limit: 5 });
  assert.equal(results[0].id, memory.id);

  await manager.destroy();
});
