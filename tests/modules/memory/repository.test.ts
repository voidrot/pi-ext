import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";
import { registerMemoryDatabaseMigrations } from "../../../src/modules/memory/models";
import {
  completeMemoryVectorJob,
  createGlobalMemory,
  createProjectMemory,
  listMemoriesForPrompt,
  listPendingMemoryVectorJobs,
  listStoredMemories,
  searchMemoriesByText,
} from "../../../src/modules/memory/repository";
import { createMemoryEmbedding } from "../../../src/modules/memory/vector";

function createCtx(cwd: string): any {
  return { cwd, isProjectTrusted: () => true };
}

async function createHandles() {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-memory-repo-"));
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  registerMemoryDatabaseMigrations(registry);
  const manager = new DatabaseManager({ agentDir: join(root, "home", ".pi", "agent"), registry });
  const handles = await manager.ensureInitialized(createCtx(join(root, "project")));
  return { manager, handles };
}

test("creates global memory and lists it for prompt", async () => {
  const { manager, handles } = await createHandles();

  const memory = await createGlobalMemory(handles.global.db, {
    content: "Always use pnpm for this user.",
    title: "Package manager preference",
    tags: ["tooling"],
    importance: 4,
  });

  const listed = await listMemoriesForPrompt(handles, { sessionId: "s1", limitPerScope: 10 });

  assert.equal(memory.scope, "global");
  assert.equal(memory.content, "Always use pnpm for this user.");
  assert.deepEqual(memory.tags, ["tooling"]);
  assert.equal(listed.global.length, 1);
  assert.equal(listed.global[0].id, memory.id);

  await manager.destroy();
});

test("lists stored memories for dashboard with per-scope rows and current session filter", async () => {
  const { manager, handles } = await createHandles();

  const global = await createGlobalMemory(handles.global.db, {
    content: "Always use pnpm for this user.",
    importance: 4,
  });
  const project = await createProjectMemory(handles.project!.db, {
    scope: "project",
    content: "Project uses strict TDD.",
    importance: 5,
  });
  const currentSession = await createProjectMemory(handles.project!.db, {
    scope: "session",
    sessionId: "session-1",
    content: "Current session memory.",
  });
  await createProjectMemory(handles.project!.db, {
    scope: "session",
    sessionId: "session-2",
    content: "Different session memory.",
  });

  const listed = await listStoredMemories(handles, { sessionId: "session-1", limitPerScope: 10 });

  assert.deepEqual(listed.global.map((memory) => memory.id), [global.id]);
  assert.deepEqual(listed.project.map((memory) => memory.id), [project.id]);
  assert.deepEqual(listed.session.map((memory) => memory.id), [currentSession.id]);

  await manager.destroy();
});

test("queues vector work and searches completed sqlite-vec vectors", async () => {
  const { manager, handles } = await createHandles();

  const packageMemory = await createGlobalMemory(handles.global.db, {
    content: "Use pnpm as the package manager for JavaScript projects.",
    tags: ["tooling"],
  });
  await createGlobalMemory(handles.global.db, {
    content: "Database migrations are registered during extension startup.",
    tags: ["database"],
  });
  const projectMemory = await createProjectMemory(handles.project!.db, {
    scope: "project",
    content: "This project uses sqlite-vec for memory vector search.",
    tags: ["memory"],
  });

  assert.deepEqual(await searchMemoriesByText(handles, { query: "pnpm package manager", limit: 3 }), []);

  const jobs = await listPendingMemoryVectorJobs(handles, { limit: 10 });
  assert.equal(jobs.length, 3);
  for (const job of jobs) {
    await completeMemoryVectorJob(handles, job, {
      provider: "local",
      dimensions: 256,
      embedding: createMemoryEmbedding(job.text),
    });
  }

  const pnpmResults = await searchMemoriesByText(handles, { query: "pnpm package manager", limit: 3 });
  const vectorResults = await searchMemoriesByText(handles, { query: "sqlite vec memory search", scopes: ["project"], limit: 3 });

  assert.equal(pnpmResults[0].id, packageMemory.id);
  assert.equal(vectorResults[0].id, projectMemory.id);
  assert.equal(vectorResults[0].scope, "project");
  assert.equal(typeof vectorResults[0].distance, "number");

  await manager.destroy();
});

test("creates project and session memories in project database", async () => {
  const { manager, handles } = await createHandles();

  const project = await createProjectMemory(handles.project!.db, {
    scope: "project",
    content: "Project uses strict TDD.",
    tags: [],
    importance: 3,
  });
  const session = await createProjectMemory(handles.project!.db, {
    scope: "session",
    sessionId: "session-1",
    content: "User wants memory planning only in this session.",
    tags: ["session"],
    importance: 5,
  });

  const listed = await listMemoriesForPrompt(handles, { sessionId: "session-1", limitPerScope: 10 });

  assert.equal(project.scope, "project");
  assert.equal(session.scope, "session");
  assert.equal(listed.project.length, 1);
  assert.equal(listed.session.length, 1);
  assert.equal(listed.session[0].content, "User wants memory planning only in this session.");

  await manager.destroy();
});
