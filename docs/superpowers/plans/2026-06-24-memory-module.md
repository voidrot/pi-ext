# Memory Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `memory` module that lets agents create global, project, and session memories, storing global memories in the global SQLite database and project/session memories in the trusted project SQLite database.

**Architecture:** The module registers database migrations for global and project memory tables, exposes three create tools (`create_global_memory`, `create_project_memory`, `create_session_memory`), and injects compact memory context into new parent sessions. A small repository layer owns Kysely SQL, a prompt layer formats memories for the system prompt, and tool handlers enforce trust/scope/session rules.

**Tech Stack:** TypeScript, Pi extension API, Kysely, SQLite/better-sqlite3, TypeBox tool schemas, Node test runner.

---

## Scope and decisions

### In scope

- Add `memory` as a first-class module in config/module/tool ownership.
- Add global DB table `pi_ext_global_memories`.
- Add project DB table `pi_ext_project_memories`; project and session memories both live here.
- Add tools:
  - `create_global_memory`
  - `create_project_memory`
  - `create_session_memory`
- Add prompt injection on `before_agent_start` for:
  - global memories from the global DB;
  - project memories from the project DB when the project is trusted;
  - session memories from the project DB where `session_id` matches the current session.
- Fail gracefully when a project/session memory is requested in an untrusted project with no project DB.
- Keep retrieval simple in MVP: inject recent/high-importance memories into the session prompt; no search/update/delete tools yet.

### Out of scope for this plan

- Embeddings/vector search.
- Memory editing/deletion.
- Automatic memory creation without an explicit tool call.
- Cross-project lookup of project/session memories.
- Dashboard UI for memories.

## Data model

Global memories table in global DB:

```sql
pi_ext_global_memories(
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  title TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

Project/session memories table in project DB:

```sql
pi_ext_project_memories(
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('project', 'session')),
  session_id TEXT,
  content TEXT NOT NULL,
  title TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

Session memories are rows with `scope = 'session'` and `session_id = ctx.sessionManager.getSessionId()`.
Project memories are rows with `scope = 'project'` and `session_id = NULL`.

## File structure

- Modify `src/core/modules.ts` — add `memory` to `ModuleId`.
- Modify `src/core/config.ts` — add `MemoryModuleConfig` defaults and normalization.
- Modify `src/core/tools.ts` — own memory tools.
- Modify `src/index.ts` — register the memory module before session-start DB initialization runs.
- Modify `config/pi-ext.example.jsonc` — document memory config.
- Modify `schema/pi-ext.schema.json` — validate memory config.
- Create `src/modules/memory/models.ts` — Kysely table types and migrations.
- Create `src/modules/memory/repository.ts` — pure DB access helpers for create/list operations.
- Create `src/modules/memory/prompt.ts` — memory prompt formatting and truncation.
- Create `src/modules/memory/tools.ts` — register the three create tools.
- Create `src/modules/memory/index.ts` — module registration, migrations, prompt injection.
- Create tests under `tests/modules/memory/` for migrations, repository, prompt formatting, tools, and module wiring.
- Update `README.md` and create/modify `docs/memory.md`.

---

### Task 1: Add memory module config and tool ownership

**Files:**
- Modify: `src/core/modules.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/tools.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/tools.test.ts`
- Modify: `tests/core/runtime.test.ts` if it has owned-tool expectations

- [ ] **Step 1: Write failing config tests**

Add these assertions to `tests/core/config.test.ts` in `loads defaults when no config exists`:

```ts
assert.equal(config.modules.memory.enabled, true);
assert.equal(config.modules.memory.prompt.enabled, true);
assert.equal(config.modules.memory.prompt.maxMemoriesPerScope, 12);
assert.equal(config.modules.memory.prompt.maxContentChars, 500);
assert.equal(config.modules.memory.tools.createGlobalMemory.enabled, true);
assert.equal(config.modules.memory.tools.createProjectMemory.enabled, true);
assert.equal(config.modules.memory.tools.createSessionMemory.enabled, true);
```

Add a new test near the other merge tests:

```ts
test("merges partial memory config without losing defaults", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    modules: {
      memory: {
        prompt: { maxMemoriesPerScope: 5 },
        tools: { createSessionMemory: { enabled: false } },
      },
    },
  });

  assert.equal(config.modules.memory.enabled, true);
  assert.equal(config.modules.memory.prompt.enabled, true);
  assert.equal(config.modules.memory.prompt.maxMemoriesPerScope, 5);
  assert.equal(config.modules.memory.prompt.maxContentChars, 500);
  assert.equal(config.modules.memory.tools.createGlobalMemory.enabled, true);
  assert.equal(config.modules.memory.tools.createProjectMemory.enabled, true);
  assert.equal(config.modules.memory.tools.createSessionMemory.enabled, false);
});
```

- [ ] **Step 2: Write failing tool ownership tests**

Update `tests/core/tools.test.ts` expected sets to include:

```ts
"create_global_memory",
"create_project_memory",
"create_session_memory",
```

In `removes owned tools when owning module is disabled`, extend the config override:

```ts
modules: { dcp: { enabled: false }, agents: { enabled: false }, memory: { enabled: false } }
```

Extend the active tools array in disabled tests with the three memory tool names.

In `removes owned tools when individual tool is disabled`, add:

```ts
memory: {
  tools: {
    createGlobalMemory: { enabled: false },
    createProjectMemory: { enabled: false },
    createSessionMemory: { enabled: false },
  },
},
```

- [ ] **Step 3: Run failing core tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/tools.test.ts
```

Expected: TypeScript/test failures for missing `memory` config and unknown module/tool ownership.

- [ ] **Step 4: Implement config types/defaults/normalization**

In `src/core/modules.ts`, change:

```ts
export type ModuleId = "dcp" | "dashboard" | "agents";
```

to:

```ts
export type ModuleId = "dcp" | "dashboard" | "agents" | "memory";
```

In `src/core/config.ts`, add after `AgentsModuleConfig`:

```ts
export interface MemoryModuleConfig {
  enabled: boolean;
  prompt: {
    enabled: boolean;
    maxMemoriesPerScope: number;
    maxContentChars: number;
  };
  tools: {
    createGlobalMemory: ToolToggleConfig;
    createProjectMemory: ToolToggleConfig;
    createSessionMemory: ToolToggleConfig;
  };
}
```

Extend `PiExtConfig.modules`:

```ts
memory: MemoryModuleConfig;
```

Add default config after `agents`:

```ts
memory: {
  enabled: true,
  prompt: {
    enabled: true,
    maxMemoriesPerScope: 12,
    maxContentChars: 500,
  },
  tools: {
    createGlobalMemory: { enabled: true },
    createProjectMemory: { enabled: true },
    createSessionMemory: { enabled: true },
  },
},
```

In `normalizeConfig`, add source records:

```ts
const memory: Record<string, any> = isPlainObject(source.modules?.memory) ? source.modules.memory : {};
const memoryPrompt: Record<string, any> = isPlainObject(memory.prompt) ? memory.prompt : {};
const memoryTools: Record<string, any> = isPlainObject(memory.tools) ? memory.tools : {};
const createGlobalMemoryTool: Record<string, any> = isPlainObject(memoryTools.createGlobalMemory) ? memoryTools.createGlobalMemory : {};
const createProjectMemoryTool: Record<string, any> = isPlainObject(memoryTools.createProjectMemory) ? memoryTools.createProjectMemory : {};
const createSessionMemoryTool: Record<string, any> = isPlainObject(memoryTools.createSessionMemory) ? memoryTools.createSessionMemory : {};
```

Add `memory` to returned `modules`:

```ts
memory: {
  enabled: boolOr(memory.enabled, defaultPiExtConfig.modules.memory.enabled),
  prompt: {
    enabled: boolOr(memoryPrompt.enabled, defaultPiExtConfig.modules.memory.prompt.enabled),
    maxMemoriesPerScope: positiveIntOr(memoryPrompt.maxMemoriesPerScope, defaultPiExtConfig.modules.memory.prompt.maxMemoriesPerScope),
    maxContentChars: positiveIntOr(memoryPrompt.maxContentChars, defaultPiExtConfig.modules.memory.prompt.maxContentChars),
  },
  tools: {
    createGlobalMemory: {
      enabled: boolOr(createGlobalMemoryTool.enabled, defaultPiExtConfig.modules.memory.tools.createGlobalMemory.enabled),
    },
    createProjectMemory: {
      enabled: boolOr(createProjectMemoryTool.enabled, defaultPiExtConfig.modules.memory.tools.createProjectMemory.enabled),
    },
    createSessionMemory: {
      enabled: boolOr(createSessionMemoryTool.enabled, defaultPiExtConfig.modules.memory.tools.createSessionMemory.enabled),
    },
  },
},
```

- [ ] **Step 5: Implement owned tools**

In `src/core/tools.ts`, append to `ownedTools`:

```ts
{
  name: "create_global_memory",
  moduleId: "memory",
  enabled: (config) => config.enabled && config.modules.memory.enabled && config.modules.memory.tools.createGlobalMemory.enabled,
},
{
  name: "create_project_memory",
  moduleId: "memory",
  enabled: (config) => config.enabled && config.modules.memory.enabled && config.modules.memory.tools.createProjectMemory.enabled,
},
{
  name: "create_session_memory",
  moduleId: "memory",
  enabled: (config) => config.enabled && config.modules.memory.enabled && config.modules.memory.tools.createSessionMemory.enabled,
},
```

- [ ] **Step 6: Run core tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/tools.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/modules.ts src/core/config.ts src/core/tools.ts tests/core/config.test.ts tests/core/tools.test.ts tests/core/runtime.test.ts
git commit -m "feat: add memory module configuration"
```

---

### Task 2: Add memory database models and migrations

**Files:**
- Create: `src/modules/memory/models.ts`
- Create: `tests/modules/memory/models.test.ts`
- Modify: `src/core/database/schema.ts` through declaration merging from the new file only

- [ ] **Step 1: Write failing migration tests**

Create `tests/modules/memory/models.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Kysely } from "kysely";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";
import { registerMemoryDatabaseMigrations } from "../../../src/modules/memory/models";

function createCtx(cwd: string): any {
  return { cwd, isProjectTrusted: () => true };
}

test("memory migrations create global and project memory tables", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-memory-models-"));
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  registerMemoryDatabaseMigrations(registry);

  const manager = new DatabaseManager({ agentDir, registry });
  const handles = await manager.ensureInitialized(createCtx(cwd));

  await (handles.global.db as Kysely<any>)
    .insertInto("pi_ext_global_memories")
    .values({ id: "g1", content: "Global preference", tags_json: "[]", importance: 3 })
    .execute();

  await (handles.project!.db as Kysely<any>)
    .insertInto("pi_ext_project_memories")
    .values({ id: "p1", scope: "project", content: "Project fact", tags_json: "[]", importance: 3 })
    .execute();

  const globalRows = await (handles.global.db as Kysely<any>).selectFrom("pi_ext_global_memories").selectAll().execute();
  const projectRows = await (handles.project!.db as Kysely<any>).selectFrom("pi_ext_project_memories").selectAll().execute();

  assert.equal(globalRows.length, 1);
  assert.equal(projectRows.length, 1);

  await manager.destroy();
});
```

- [ ] **Step 2: Run failing migration test**

Run:

```bash
npm test -- tests/modules/memory/models.test.ts
```

Expected: module not found for `src/modules/memory/models`.

- [ ] **Step 3: Implement models and migrations**

Create `src/modules/memory/models.ts`:

```ts
import type { Generated, Kysely } from "kysely";
import { sql } from "kysely";
import type { MigrationMap } from "../../core/database/registry";
import { defineTableModel, type DatabaseScope } from "../../core/database/schema";

export type MemoryScope = "global" | "project" | "session";
export type ProjectMemoryScope = "project" | "session";

export interface MemoryMigrationRegistry {
  register(scope: DatabaseScope, moduleId: string, migrations: MigrationMap): void;
}

export interface GlobalMemoryTable {
  id: string;
  content: string;
  title: string | null;
  tags_json: string;
  importance: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ProjectMemoryTable {
  id: string;
  scope: ProjectMemoryScope;
  session_id: string | null;
  content: string;
  title: string | null;
  tags_json: string;
  importance: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

declare module "../../core/database/schema" {
  interface GlobalDatabase {
    pi_ext_global_memories: GlobalMemoryTable;
  }

  interface ProjectDatabase {
    pi_ext_project_memories: ProjectMemoryTable;
  }
}

export const globalMemoryModel = defineTableModel({ scope: "global", tableName: "pi_ext_global_memories" });
export const projectMemoryModel = defineTableModel({ scope: "project", tableName: "pi_ext_project_memories" });

export function registerMemoryDatabaseMigrations(registry: MemoryMigrationRegistry): void {
  registry.register("global", "memory", {
    "0001_create_global_memories": {
      up: async (db: Kysely<any>) => createGlobalMemoriesTable(db),
      down: async (db: Kysely<any>) => db.schema.dropTable("pi_ext_global_memories").ifExists().execute(),
    },
  });

  registry.register("project", "memory", {
    "0001_create_project_memories": {
      up: async (db: Kysely<any>) => createProjectMemoriesTable(db),
      down: async (db: Kysely<any>) => db.schema.dropTable("pi_ext_project_memories").ifExists().execute(),
    },
  });
}

async function createGlobalMemoriesTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("pi_ext_global_memories")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey().notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("title", "text")
    .addColumn("tags_json", "text", (col) => col.defaultTo("[]").notNull())
    .addColumn("importance", "integer", (col) => col.defaultTo(3).notNull())
    .addColumn("created_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updated_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("idx_pi_ext_global_memories_importance_created").ifNotExists().on("pi_ext_global_memories").columns(["importance", "created_at"]).execute();
}

async function createProjectMemoriesTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("pi_ext_project_memories")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey().notNull())
    .addColumn("scope", "text", (col) => col.notNull().check(sql`scope in ('project', 'session')`))
    .addColumn("session_id", "text")
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("title", "text")
    .addColumn("tags_json", "text", (col) => col.defaultTo("[]").notNull())
    .addColumn("importance", "integer", (col) => col.defaultTo(3).notNull())
    .addColumn("created_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updated_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("idx_pi_ext_project_memories_scope_session").ifNotExists().on("pi_ext_project_memories").columns(["scope", "session_id"]).execute();
  await db.schema.createIndex("idx_pi_ext_project_memories_importance_created").ifNotExists().on("pi_ext_project_memories").columns(["importance", "created_at"]).execute();
}
```

- [ ] **Step 4: Run migration tests**

Run:

```bash
npm test -- tests/modules/memory/models.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/models.ts tests/modules/memory/models.test.ts
git commit -m "feat: add memory database migrations"
```

---

### Task 3: Implement memory repository

**Files:**
- Create: `src/modules/memory/repository.ts`
- Create: `tests/modules/memory/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/modules/memory/repository.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";
import { createGlobalMemory, createProjectMemory, listMemoriesForPrompt } from "../../../src/modules/memory/repository";
import { registerMemoryDatabaseMigrations } from "../../../src/modules/memory/models";

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
```

- [ ] **Step 2: Run failing repository tests**

Run:

```bash
npm test -- tests/modules/memory/repository.test.ts
```

Expected: module not found for `repository.ts`.

- [ ] **Step 3: Implement repository**

Create `src/modules/memory/repository.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { PiExtDatabaseHandles } from "../../core/database/manager";
import type { GlobalDatabase, ProjectDatabase } from "../../core/database/schema";
import type { ProjectMemoryScope } from "./models";

export interface MemoryRecord {
  id: string;
  scope: "global" | "project" | "session";
  content: string;
  title?: string;
  tags: string[];
  importance: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
}

export interface CreateMemoryInput {
  content: string;
  title?: string;
  tags?: string[];
  importance?: number;
}

export interface CreateProjectMemoryInput extends CreateMemoryInput {
  scope: ProjectMemoryScope;
  sessionId?: string;
}

export interface PromptMemoryList {
  global: MemoryRecord[];
  project: MemoryRecord[];
  session: MemoryRecord[];
}

export async function createGlobalMemory(db: Kysely<GlobalDatabase>, input: CreateMemoryInput): Promise<MemoryRecord> {
  const id = randomUUID();
  const row = {
    id,
    content: input.content.trim(),
    title: normalizeOptionalString(input.title),
    tags_json: JSON.stringify(normalizeTags(input.tags)),
    importance: normalizeImportance(input.importance),
  };

  await db.insertInto("pi_ext_global_memories").values(row).execute();
  const saved = await db.selectFrom("pi_ext_global_memories").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return mapGlobalRow(saved);
}

export async function createProjectMemory(db: Kysely<ProjectDatabase>, input: CreateProjectMemoryInput): Promise<MemoryRecord> {
  const id = randomUUID();
  const row = {
    id,
    scope: input.scope,
    session_id: input.scope === "session" ? input.sessionId ?? null : null,
    content: input.content.trim(),
    title: normalizeOptionalString(input.title),
    tags_json: JSON.stringify(normalizeTags(input.tags)),
    importance: normalizeImportance(input.importance),
  };

  await db.insertInto("pi_ext_project_memories").values(row).execute();
  const saved = await db.selectFrom("pi_ext_project_memories").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return mapProjectRow(saved);
}

export async function listMemoriesForPrompt(
  handles: PiExtDatabaseHandles,
  options: { sessionId?: string; limitPerScope: number },
): Promise<PromptMemoryList> {
  const globalRows = await handles.global.db
    .selectFrom("pi_ext_global_memories")
    .selectAll()
    .orderBy("importance", "desc")
    .orderBy("created_at", "desc")
    .limit(options.limitPerScope)
    .execute();

  const projectRows = handles.project
    ? await handles.project.db
        .selectFrom("pi_ext_project_memories")
        .selectAll()
        .where("scope", "=", "project")
        .orderBy("importance", "desc")
        .orderBy("created_at", "desc")
        .limit(options.limitPerScope)
        .execute()
    : [];

  const sessionRows = handles.project && options.sessionId
    ? await handles.project.db
        .selectFrom("pi_ext_project_memories")
        .selectAll()
        .where("scope", "=", "session")
        .where("session_id", "=", options.sessionId)
        .orderBy("importance", "desc")
        .orderBy("created_at", "desc")
        .limit(options.limitPerScope)
        .execute()
    : [];

  return {
    global: globalRows.map(mapGlobalRow),
    project: projectRows.map(mapProjectRow),
    session: sessionRows.map(mapProjectRow),
  };
}

function mapGlobalRow(row: any): MemoryRecord {
  return {
    id: row.id,
    scope: "global",
    content: row.content,
    title: row.title ?? undefined,
    tags: parseTags(row.tags_json),
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectRow(row: any): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    title: row.title ?? undefined,
    tags: parseTags(row.tags_json),
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionId: row.session_id ?? undefined,
  };
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function normalizeImportance(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 1 && value! <= 5 ? value! : 3;
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run repository tests**

Run:

```bash
npm test -- tests/modules/memory/repository.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/repository.ts tests/modules/memory/repository.test.ts
git commit -m "feat: add memory repository"
```

---

### Task 4: Format memories for prompt injection

**Files:**
- Create: `src/modules/memory/prompt.ts`
- Create: `tests/modules/memory/prompt.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Create `tests/modules/memory/prompt.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { formatMemoryPrompt } from "../../../src/modules/memory/prompt";
import type { PromptMemoryList } from "../../../src/modules/memory/repository";

const memories: PromptMemoryList = {
  global: [{ id: "g1", scope: "global", content: "Use concise answers.", title: "Style", tags: ["style"], importance: 4, createdAt: "now", updatedAt: "now" }],
  project: [{ id: "p1", scope: "project", content: "This repo uses npm scripts.", tags: [], importance: 3, createdAt: "now", updatedAt: "now" }],
  session: [{ id: "s1", scope: "session", content: "In this session, only plan changes.", tags: ["session"], importance: 5, createdAt: "now", updatedAt: "now", sessionId: "session-1" }],
};

test("formats scoped memories for system prompt", () => {
  const prompt = formatMemoryPrompt(memories, { maxContentChars: 80 });

  assert.match(prompt, /Relevant saved memories/);
  assert.match(prompt, /Global memories/);
  assert.match(prompt, /Project memories/);
  assert.match(prompt, /Session memories/);
  assert.match(prompt, /Use concise answers/);
  assert.match(prompt, /This repo uses npm scripts/);
  assert.match(prompt, /only plan changes/);
});

test("returns empty string when no memories exist", () => {
  const prompt = formatMemoryPrompt({ global: [], project: [], session: [] }, { maxContentChars: 80 });

  assert.equal(prompt, "");
});

test("truncates long memory content", () => {
  const prompt = formatMemoryPrompt({ global: [{ ...memories.global[0], content: "a".repeat(100) }], project: [], session: [] }, { maxContentChars: 12 });

  assert.match(prompt, /aaaaaaaaaaaa…/);
});
```

- [ ] **Step 2: Run failing prompt tests**

Run:

```bash
npm test -- tests/modules/memory/prompt.test.ts
```

Expected: module not found for `prompt.ts`.

- [ ] **Step 3: Implement prompt formatter**

Create `src/modules/memory/prompt.ts`:

```ts
import type { MemoryRecord, PromptMemoryList } from "./repository";

export interface MemoryPromptOptions {
  maxContentChars: number;
}

export function formatMemoryPrompt(memories: PromptMemoryList, options: MemoryPromptOptions): string {
  const sections = [
    formatSection("Global memories", memories.global, options),
    formatSection("Project memories", memories.project, options),
    formatSection("Session memories", memories.session, options),
  ].filter(Boolean);

  if (sections.length === 0) return "";

  return [
    "Relevant saved memories are available. Treat them as user/project/session preferences and facts, but do not mention them unless relevant.",
    ...sections,
  ].join("\n\n");
}

function formatSection(title: string, memories: MemoryRecord[], options: MemoryPromptOptions): string {
  if (memories.length === 0) return "";
  const lines = memories.map((memory) => {
    const label = memory.title ? `${memory.title}: ` : "";
    const tags = memory.tags.length > 0 ? ` [tags: ${memory.tags.join(", ")}]` : "";
    return `- (${memory.id}, importance ${memory.importance}) ${label}${truncate(memory.content, options.maxContentChars)}${tags}`;
  });
  return [`${title}:`, ...lines].join("\n");
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + "…";
}
```

- [ ] **Step 4: Run prompt tests**

Run:

```bash
npm test -- tests/modules/memory/prompt.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/prompt.ts tests/modules/memory/prompt.test.ts
git commit -m "feat: format memories for prompt context"
```

---

### Task 5: Register memory creation tools

**Files:**
- Create: `src/modules/memory/tools.ts`
- Create: `tests/modules/memory/tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `tests/modules/memory/tools.test.ts`:

```ts
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

test("create_global_memory stores a global memory", async () => {
  const { pi, tools } = createPiCapture();
  const calls: any[] = [];
  registerMemoryTools(pi as any, {
    isEnabled: () => true,
    getDatabases: async () => ({ global: { db: "global-db" } }),
    createGlobalMemory: async (_db, input) => { calls.push(input); return { id: "g1", scope: "global", content: input.content, tags: input.tags ?? [], importance: input.importance ?? 3, createdAt: "now", updatedAt: "now" }; },
    createProjectMemory: async () => { throw new Error("unexpected"); },
  } as any);

  const result = await tools.get("create_global_memory").execute("id", { content: "Remember this", tags: ["a"], importance: 4 }, undefined, undefined, ctx);

  assert.deepEqual(calls[0], { content: "Remember this", tags: ["a"], importance: 4 });
  assert.match(result.content[0].text, /Created global memory g1/);
});

test("create_project_memory requires a project database", async () => {
  const { pi, tools } = createPiCapture();
  registerMemoryTools(pi as any, {
    isEnabled: () => true,
    getDatabases: async () => ({ global: { db: "global-db" } }),
    createGlobalMemory: async () => { throw new Error("unexpected"); },
    createProjectMemory: async () => { throw new Error("unexpected"); },
  } as any);

  const result = await tools.get("create_project_memory").execute("id", { content: "Project fact" }, undefined, undefined, ctx);

  assert.match(result.content[0].text, /Project memories require a trusted project/);
});

test("create_session_memory stores session id", async () => {
  const { pi, tools } = createPiCapture();
  let input: any;
  registerMemoryTools(pi as any, {
    isEnabled: () => true,
    getDatabases: async () => ({ global: { db: "global-db" }, project: { db: "project-db" } }),
    createGlobalMemory: async () => { throw new Error("unexpected"); },
    createProjectMemory: async (_db, value) => { input = value; return { id: "s1", scope: "session", content: value.content, tags: [], importance: 3, createdAt: "now", updatedAt: "now", sessionId: value.sessionId }; },
  } as any);

  const result = await tools.get("create_session_memory").execute("id", { content: "Session fact" }, undefined, undefined, ctx);

  assert.equal(input.scope, "session");
  assert.equal(input.sessionId, "session-1");
  assert.match(result.content[0].text, /Created session memory s1/);
});
```

- [ ] **Step 2: Run failing tool tests**

Run:

```bash
npm test -- tests/modules/memory/tools.test.ts
```

Expected: module not found for `tools.ts`.

- [ ] **Step 3: Implement memory tools**

Create `src/modules/memory/tools.ts`:

```ts
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiExtDatabaseHandles } from "../../core/database/manager";
import type { GlobalDatabase, ProjectDatabase } from "../../core/database/schema";
import type { Kysely } from "kysely";
import { createGlobalMemory, createProjectMemory, type CreateMemoryInput, type CreateProjectMemoryInput, type MemoryRecord } from "./repository";

export interface RegisterMemoryToolsDeps {
  isEnabled(ctx: ExtensionContext): boolean;
  getDatabases(ctx: ExtensionContext): Promise<PiExtDatabaseHandles>;
  createGlobalMemory?: (db: Kysely<GlobalDatabase>, input: CreateMemoryInput) => Promise<MemoryRecord>;
  createProjectMemory?: (db: Kysely<ProjectDatabase>, input: CreateProjectMemoryInput) => Promise<MemoryRecord>;
}

const createMemoryParams = Type.Object({
  content: Type.String({ minLength: 1, description: "Memory content to save." }),
  title: Type.Optional(Type.String({ description: "Short optional title for the memory." })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for later grouping." })),
  importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Importance from 1 to 5. Defaults to 3." })),
});

export function registerMemoryTools(pi: ExtensionAPI, deps: RegisterMemoryToolsDeps): void {
  const saveGlobal = deps.createGlobalMemory ?? createGlobalMemory;
  const saveProject = deps.createProjectMemory ?? createProjectMemory;

  pi.registerTool({
    name: "create_global_memory",
    description: "Save a durable global memory in the user's global Pi Ext database.",
    parameters: createMemoryParams,
    promptSnippet: "create_global_memory: Save durable user-level facts or preferences that should apply across projects.",
    promptGuidelines: ["Use only for stable cross-project preferences or facts the user wants remembered."],
    execute: async (_toolCallId, params, _start, _update, ctx) => {
      if (!deps.isEnabled(ctx)) return textResult("Memory module is disabled.");
      const input = normalizeInput(params);
      const handles = await deps.getDatabases(ctx);
      const memory = await saveGlobal(handles.global.db, input);
      return textResult(`Created global memory ${memory.id}: ${memory.content}`);
    },
  });

  pi.registerTool({
    name: "create_project_memory",
    description: "Save a durable project memory in this trusted project's Pi Ext database.",
    parameters: createMemoryParams,
    promptSnippet: "create_project_memory: Save durable facts or preferences that apply only to this project.",
    promptGuidelines: ["Use for repository-specific conventions, architecture facts, commands, or user preferences."],
    execute: async (_toolCallId, params, _start, _update, ctx) => {
      if (!deps.isEnabled(ctx)) return textResult("Memory module is disabled.");
      const handles = await deps.getDatabases(ctx);
      if (!handles.project) return textResult("Project memories require a trusted project with a project database.");
      const memory = await saveProject(handles.project.db, { ...normalizeInput(params), scope: "project" });
      return textResult(`Created project memory ${memory.id}: ${memory.content}`);
    },
  });

  pi.registerTool({
    name: "create_session_memory",
    description: "Save a memory scoped to the current session in this trusted project's Pi Ext database.",
    parameters: createMemoryParams,
    promptSnippet: "create_session_memory: Save facts or instructions that should apply only to the current session.",
    promptGuidelines: ["Use for session-only decisions, temporary constraints, or current task state."],
    execute: async (_toolCallId, params, _start, _update, ctx) => {
      if (!deps.isEnabled(ctx)) return textResult("Memory module is disabled.");
      const handles = await deps.getDatabases(ctx);
      if (!handles.project) return textResult("Session memories require a trusted project with a project database.");
      const sessionId = ctx.sessionManager.getSessionId();
      const memory = await saveProject(handles.project.db, { ...normalizeInput(params), scope: "session", sessionId });
      return textResult(`Created session memory ${memory.id}: ${memory.content}`);
    },
  });
}

function normalizeInput(params: any): CreateMemoryInput {
  return {
    content: String(params.content).trim(),
    title: typeof params.title === "string" ? params.title.trim() : undefined,
    tags: Array.isArray(params.tags) ? params.tags.filter((tag: unknown): tag is string => typeof tag === "string") : undefined,
    importance: typeof params.importance === "number" ? params.importance : undefined,
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
```

- [ ] **Step 4: Run tool tests**

Run:

```bash
npm test -- tests/modules/memory/tools.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/tools.ts tests/modules/memory/tools.test.ts
git commit -m "feat: add memory creation tools"
```

---

### Task 6: Wire memory module, migrations, and prompt injection

**Files:**
- Create: `src/modules/memory/index.ts`
- Modify: `src/index.ts`
- Create: `tests/modules/memory/module.test.ts`

- [ ] **Step 1: Write failing module tests**

Create `tests/modules/memory/module.test.ts`:

```ts
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
```

- [ ] **Step 2: Run failing module tests**

Run:

```bash
npm test -- tests/modules/memory/module.test.ts
```

Expected: module not found for `src/modules/memory`.

- [ ] **Step 3: Implement module registration**

Create `src/modules/memory/index.ts`:

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModuleApi, PiExtModule } from "../../core/modules";
import { registerMemoryDatabaseMigrations, type MemoryMigrationRegistry } from "./models";
import { formatMemoryPrompt } from "./prompt";
import { listMemoriesForPrompt as defaultListMemoriesForPrompt } from "./repository";
import { registerMemoryTools } from "./tools";

export interface MemoryModuleOptions {
  listMemoriesForPrompt?: typeof defaultListMemoriesForPrompt;
}

export const memoryModule = createMemoryModule();

export function createMemoryModule(options: MemoryModuleOptions = {}): PiExtModule {
  return {
    id: "memory",
    label: "Memory",
    register(api) {
      registerMemory(api, options);
    },
  };
}

function registerMemory(api: ModuleApi, options: MemoryModuleOptions): void {
  const listMemoriesForPrompt = options.listMemoriesForPrompt ?? defaultListMemoriesForPrompt;
  const registry: MemoryMigrationRegistry = {
    register(scope, moduleId, migrations) {
      api.registerDatabaseMigrations(scope, moduleId as "memory", migrations);
    },
  };

  registerMemoryDatabaseMigrations(registry);

  registerMemoryTools(api.pi, {
    isEnabled: (ctx: ExtensionContext) => api.isEnabled(ctx, "memory"),
    getDatabases: (ctx: ExtensionContext) => api.getDatabases(ctx),
  });

  api.pi.on("before_agent_start", async (event, ctx) => {
    const runtime = api.getRuntime(ctx);
    const config = runtime.config.modules.memory;
    if (!runtime.config.enabled || !config.enabled || !config.prompt.enabled || !api.isEnabled(ctx, "memory")) return;

    const handles = await api.getDatabases(ctx);
    const memories = await listMemoriesForPrompt(handles, {
      sessionId: ctx.sessionManager.getSessionId(),
      limitPerScope: config.prompt.maxMemoriesPerScope,
    });
    const prompt = formatMemoryPrompt(memories, { maxContentChars: config.prompt.maxContentChars });
    if (!prompt) return;

    return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
  });
}
```

- [ ] **Step 4: Register module in extension entrypoint**

In `src/index.ts`, add import:

```ts
import { memoryModule } from "./modules/memory";
```

Register it before `agentsModule.register(moduleApi)`:

```ts
dcpModule.register(moduleApi);
dashboardModule.register(moduleApi);
memoryModule.register(moduleApi);
agentsModule.register(moduleApi);
```

- [ ] **Step 5: Run module tests**

Run:

```bash
npm test -- tests/modules/memory/module.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/memory/index.ts src/index.ts tests/modules/memory/module.test.ts
git commit -m "feat: wire memory module"
```

---

### Task 7: Update schema, example config, and docs

**Files:**
- Modify: `schema/pi-ext.schema.json`
- Modify: `config/pi-ext.example.jsonc`
- Modify: `README.md`
- Create: `docs/memory.md`

- [ ] **Step 1: Update example config**

Add under `modules` in `config/pi-ext.example.jsonc`:

```jsonc
"memory": {
  "enabled": true,
  "prompt": {
    "enabled": true,
    "maxMemoriesPerScope": 12,
    "maxContentChars": 500
  },
  "tools": {
    "createGlobalMemory": { "enabled": true },
    "createProjectMemory": { "enabled": true },
    "createSessionMemory": { "enabled": true }
  }
}
```

- [ ] **Step 2: Update JSON schema**

In `schema/pi-ext.schema.json`, add `memory` under `properties.modules.properties`:

```json
"memory": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enabled": { "type": "boolean" },
    "prompt": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": { "type": "boolean" },
        "maxMemoriesPerScope": { "type": "integer", "minimum": 1, "maximum": 100 },
        "maxContentChars": { "type": "integer", "minimum": 80, "maximum": 4000 }
      }
    },
    "tools": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "createGlobalMemory": {
          "type": "object",
          "additionalProperties": false,
          "properties": { "enabled": { "type": "boolean" } }
        },
        "createProjectMemory": {
          "type": "object",
          "additionalProperties": false,
          "properties": { "enabled": { "type": "boolean" } }
        },
        "createSessionMemory": {
          "type": "object",
          "additionalProperties": false,
          "properties": { "enabled": { "type": "boolean" } }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Add memory docs**

Create `docs/memory.md`:

```markdown
# Memory module

The memory module lets an agent save durable memories at three scopes.

## Scopes

- Global memories are stored in the global Pi Ext database and apply across projects.
- Project memories are stored in the trusted project's `.pi/pi-ext.db` and apply to that repository.
- Session memories are stored in the trusted project's `.pi/pi-ext.db` with the current Pi session ID and apply only to the current session.

Project and session memories require a trusted project because they write to the project database.

## Tools

### create_global_memory

Use for stable cross-project preferences or facts.

```json
{ "content": "Prefer concise answers unless I ask for detail.", "tags": ["style"], "importance": 4 }
```

### create_project_memory

Use for repository-specific facts, commands, conventions, or architecture notes.

```json
{ "content": "This repo uses npm test and npm run typecheck for validation.", "tags": ["commands"], "importance": 4 }
```

### create_session_memory

Use for temporary constraints or decisions that should apply only to the current session.

```json
{ "content": "For this session, only plan the memory module; do not implement it yet.", "tags": ["session"], "importance": 5 }
```

## Prompt injection

At session start, Pi Ext injects a compact list of recent/high-importance global, project, and matching session memories into the system prompt when `modules.memory.prompt.enabled` is true.
```

- [ ] **Step 4: Update README**

Add a concise bullet in `README.md` near other module descriptions:

```markdown
- **Memory**: save global, project, and session-scoped memories in Pi Ext SQLite databases with `create_global_memory`, `create_project_memory`, and `create_session_memory`.
```

- [ ] **Step 5: Run docs/config validation tests**

Run:

```bash
npm test -- tests/core/config.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add schema/pi-ext.schema.json config/pi-ext.example.jsonc README.md docs/memory.md
git commit -m "docs: describe memory module"
```

---

### Task 8: Full validation and cleanup

**Files:**
- No planned source changes unless validation reveals issues.

- [ ] **Step 1: Run focused memory tests**

Run:

```bash
npm test -- tests/modules/memory/models.test.ts tests/modules/memory/repository.test.ts tests/modules/memory/prompt.test.ts tests/modules/memory/tools.test.ts tests/modules/memory/module.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run full validation**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 3: Check git status and protect unrelated changes**

Run:

```bash
git status --short
```

Expected: only memory-module changes plus any pre-existing unrelated dirty files. Do not stage unrelated files such as `.pi/pi-ext.db-shm`, `.pi/pi-ext.db-wal`, `src/modules/dashboard/server.ts`, or `tests/modules/dashboard/server.test.ts` unless the user explicitly asks.

- [ ] **Step 4: Commit validation fixes if any**

If validation required fixes, commit only those files:

```bash
git diff --name-only -- src/core src/modules/memory tests/core tests/modules/memory config schema README.md docs/memory.md docs/superpowers/plans/2026-06-24-memory-module.md | xargs git add
git commit -m "fix: stabilize memory module"
```

If no fixes were needed, skip this step.

---

## Self-review

- Spec coverage: global memories use the global DB via `pi_ext_global_memories`; project and session memories use the project DB via `pi_ext_project_memories`; tools exist to create all three levels; prompt injection makes saved memories useful in later sessions.
- Trust boundary: project/session memory writes fail gracefully when no trusted project DB is available.
- Storage boundary: no global table stores project/session data; no project table stores global data.
- Placeholder scan: no `TBD`, no `TODO`, no missing code snippets for planned implementation steps.
- Type consistency: tool/config names use `createGlobalMemory`, `createProjectMemory`, `createSessionMemory` in config and `create_global_memory`, `create_project_memory`, `create_session_memory` for tool names.
