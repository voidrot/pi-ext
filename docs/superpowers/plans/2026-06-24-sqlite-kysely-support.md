# SQLite Kysely Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite persistence backed by Kysely so core and modules can own scoped table models and migrations for both the global database (`~/.pi/pi-ext.db`) and project database (`.pi/pi-ext.db`).

**Architecture:** Add a core database subsystem with path resolution, Kysely/better-sqlite3 connection management, an in-code migration registry, and an async database manager. Core and modules register migrations during extension registration; startup opens both databases and runs `Migrator.migrateToLatest()` for each scope. Table models express scope by augmenting either `GlobalDatabase` or `ProjectDatabase` and exporting a scoped table descriptor.

**Tech Stack:** TypeScript ESM, Kysely, better-sqlite3, Kysely `Migrator` with a custom in-memory `MigrationProvider`, Node test runner with `tsx`.

---

## Design Decisions

- Use `better-sqlite3` as the SQLite driver for Kysely's `SqliteDialect`.
- Store global DB at `join(dirname(getAgentDir()), "pi-ext.db")`; current Pi returns `getAgentDir() === ~/.pi/agent`, so this resolves to `~/.pi/pi-ext.db`.
- Store project DB at `join(ctx.cwd, CONFIG_DIR_NAME, "pi-ext.db")`.
- Run migrations idempotently on `session_start`; also call through an idempotent `ensureInitialized(ctx)` from `session_tree` so startup ordering cannot skip migrations.
- Preserve Pi's project-trust model: create/migrate the project DB only when `ctx.isProjectTrusted()` is true. If product direction requires unconditional `.pi/pi-ext.db`, remove this guard in `DatabaseManager.resolveTargets` and update tests.
- Use migration table names `pi_ext_migration` and `pi_ext_migration_lock` in both DBs.
- Prefix registered migration names with module id, e.g. `core__0001_create_core_metadata`, to avoid cross-module name collisions.
- Do not create feature tables for DCP yet unless DCP needs them; this change creates the framework and one small core metadata table to prove core migrations work.

## Target Source Structure

- Create: `src/core/database/schema.ts` — globally augmentable Kysely database interfaces plus `TableModel` descriptors.
- Create: `src/core/database/paths.ts` — global/project DB path resolution and directory creation helpers.
- Create: `src/core/database/connection.ts` — open/destroy better-sqlite3 + Kysely handles.
- Create: `src/core/database/registry.ts` — in-memory migration registration and Kysely migration provider.
- Create: `src/core/database/manager.ts` — idempotent startup initialization and migrated DB accessors.
- Create: `src/core/database/core-models.ts` — core table type/descriptors and core migrations.
- Modify: `src/core/modules.ts` — expose database registration/access through `ModuleApi`.
- Modify: `src/core/runtime.ts` — add `agentDir` to runtime metadata if needed by database manager tests/logging.
- Modify: `src/index.ts` — construct database registry/manager, register core migrations, pass database API to modules, run startup migrations.
- Modify: `tsup.config.ts` — externalize native/runtime database dependencies.
- Modify: `package.json`, `package-lock.json` — add database dependencies.
- Create tests: `tests/core/database/*.test.ts`.

## Model Pattern

Each table model file should do both of these:

```ts
import type { Generated } from "kysely";
import { defineTableModel } from "./schema";

export interface CoreMetadataTable {
  key: string;
  value: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

declare module "./schema" {
  interface GlobalDatabase {
    pi_ext_metadata: CoreMetadataTable;
  }

  interface ProjectDatabase {
    pi_ext_project_metadata: CoreMetadataTable;
  }
}

export const globalCoreMetadataModel = defineTableModel({
  scope: "global",
  tableName: "pi_ext_metadata",
});

export const projectCoreMetadataModel = defineTableModel({
  scope: "project",
  tableName: "pi_ext_project_metadata",
});
```

For module models, use a relative module augmentation path to `src/core/database/schema.ts`, for example from `src/modules/dcp/db/models.ts`:

```ts
declare module "../../../core/database/schema" {
  interface ProjectDatabase {
    dcp_example: DcpExampleTable;
  }
}
```

---

## Task 1: Add Dependencies and Build Externals

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsup.config.ts`

- [ ] **Step 1: Install runtime and type dependencies**

Run:

```bash
npm install kysely@^0.29.2 better-sqlite3@^12.11.1
npm install -D @types/better-sqlite3@^7.6.13
```

Expected: `package.json` and `package-lock.json` include the new packages.

- [ ] **Step 2: Externalize native/runtime DB packages in tsup**

Edit `tsup.config.ts` and include these externals:

```ts
external: [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
  "tiktoken",
  "better-sqlite3",
  "kysely",
]
```

- [ ] **Step 3: Verify typecheck still reaches current failures only**

Run:

```bash
npm run typecheck
```

Expected: PASS if only dependency files were changed. If `tsup.config.ts` imports remain unchanged, no new source imports are required in this task.

---

## Task 2: Add Scoped Database Types and Path Helpers

**Files:**
- Create: `src/core/database/schema.ts`
- Create: `src/core/database/paths.ts`
- Create tests: `tests/core/database/paths.test.ts`

- [ ] **Step 1: Write path tests**

Create `tests/core/database/paths.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveGlobalDatabasePath, resolveProjectDatabasePath } from "../../../src/core/database/paths";

const root = mkdtempSync(join(tmpdir(), "pi-ext-db-paths-"));

test("resolves global database beside the agent directory", () => {
  const agentDir = join(root, ".pi", "agent");
  assert.equal(resolveGlobalDatabasePath(agentDir), join(dirname(agentDir), "pi-ext.db"));
});

test("resolves project database under project .pi directory", () => {
  assert.equal(resolveProjectDatabasePath(root), join(root, ".pi", "pi-ext.db"));
});
```

- [ ] **Step 2: Implement scoped schema types**

Create `src/core/database/schema.ts`:

```ts
import type { Kysely } from "kysely";

export type DatabaseScope = "global" | "project";

export interface GlobalDatabase {}
export interface ProjectDatabase {}

export type ScopedDatabase<S extends DatabaseScope> = S extends "global" ? GlobalDatabase : ProjectDatabase;
export type ScopedKysely<S extends DatabaseScope> = Kysely<ScopedDatabase<S>>;

export interface TableModel<S extends DatabaseScope = DatabaseScope, Name extends string = string> {
  readonly scope: S;
  readonly tableName: Name;
}

export function defineTableModel<S extends DatabaseScope, Name extends string>(model: TableModel<S, Name>): TableModel<S, Name> {
  return model;
}
```

- [ ] **Step 3: Implement path helpers**

Create `src/core/database/paths.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export const PI_EXT_DATABASE_FILE = "pi-ext.db";

export function resolveGlobalDatabasePath(agentDir: string): string {
  return join(dirname(agentDir), PI_EXT_DATABASE_FILE);
}

export function resolveProjectDatabasePath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, PI_EXT_DATABASE_FILE);
}

export function ensureDatabaseDirectory(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
}
```

- [ ] **Step 4: Run path tests**

Run:

```bash
node --import tsx --test tests/core/database/paths.test.ts
```

Expected: PASS.

---

## Task 3: Add Connection and Migration Registry

**Files:**
- Create: `src/core/database/connection.ts`
- Create: `src/core/database/registry.ts`
- Create tests: `tests/core/database/registry.test.ts`

- [ ] **Step 1: Write registry tests**

Create `tests/core/database/registry.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";

const migration = { up: async () => undefined, down: async () => undefined };

test("prefixes migrations by scope and module id", async () => {
  const registry = new DatabaseMigrationRegistry();
  registry.register("global", "core", { "0001_create_metadata": migration });

  const migrations = await registry.createProvider("global").getMigrations();
  assert.deepEqual(Object.keys(migrations), ["core__0001_create_metadata"]);
});

test("rejects duplicate migration names within a scope", () => {
  const registry = new DatabaseMigrationRegistry();
  registry.register("project", "core", { "0001_init": migration });

  assert.throws(
    () => registry.register("project", "core", { "0001_init": migration }),
    /Duplicate project migration core__0001_init/,
  );
});
```

- [ ] **Step 2: Implement registry**

Create `src/core/database/registry.ts`:

```ts
import type { Migration, MigrationProvider } from "kysely/migration";
import type { DatabaseScope } from "./schema";

export type MigrationMap = Record<string, Migration>;

export class DatabaseMigrationRegistry {
  private readonly migrations: Record<DatabaseScope, Map<string, Migration>> = {
    global: new Map(),
    project: new Map(),
  };

  register(scope: DatabaseScope, moduleId: string, migrations: MigrationMap): void {
    for (const [name, migration] of Object.entries(migrations)) {
      const fullName = `${moduleId}__${name}`;
      const scoped = this.migrations[scope];
      if (scoped.has(fullName)) throw new Error(`Duplicate ${scope} migration ${fullName}`);
      scoped.set(fullName, migration);
    }
  }

  createProvider(scope: DatabaseScope): MigrationProvider {
    return {
      getMigrations: async () => Object.fromEntries([...this.migrations[scope].entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
  }
}
```

- [ ] **Step 3: Implement connection helper**

Create `src/core/database/connection.ts`:

```ts
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { ensureDatabaseDirectory } from "./paths";
import type { DatabaseScope, ScopedDatabase } from "./schema";

export interface OpenedSqliteDatabase<S extends DatabaseScope> {
  readonly scope: S;
  readonly path: string;
  readonly sqlite: BetterSqlite3.Database;
  readonly db: Kysely<ScopedDatabase<S>>;
  destroy(): Promise<void>;
}

export function openSqliteDatabase<S extends DatabaseScope>(scope: S, path: string): OpenedSqliteDatabase<S> {
  ensureDatabaseDirectory(path);
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  const db = new Kysely<ScopedDatabase<S>>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  return {
    scope,
    path,
    sqlite,
    db,
    async destroy() {
      await db.destroy();
    },
  };
}
```

- [ ] **Step 4: Run registry tests**

Run:

```bash
node --import tsx --test tests/core/database/registry.test.ts
```

Expected: PASS.

---

## Task 4: Add Core Models, Core Migrations, and Database Manager

**Files:**
- Create: `src/core/database/core-models.ts`
- Create: `src/core/database/manager.ts`
- Create tests: `tests/core/database/manager.test.ts`

- [ ] **Step 1: Write manager tests**

Create `tests/core/database/manager.test.ts` with two cases:

```ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";

function createCtx(cwd: string, trusted: boolean): any {
  return { cwd, isProjectTrusted: () => trusted };
}

test("initializes global and trusted project databases", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-db-manager-"));
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  const manager = new DatabaseManager({ agentDir, registry });

  const handles = await manager.ensureInitialized(createCtx(cwd, true));

  assert.equal(existsSync(join(root, "home", ".pi", "pi-ext.db")), true);
  assert.equal(existsSync(join(root, "project", ".pi", "pi-ext.db")), true);
  assert.ok(handles.project);

  const globalRows = await handles.global.db.selectFrom("pi_ext_metadata").selectAll().execute();
  assert.deepEqual(globalRows, []);
  const projectRows = await handles.project!.db.selectFrom("pi_ext_project_metadata").selectAll().execute();
  assert.deepEqual(projectRows, []);

  await manager.destroy();
});

test("skips project database for untrusted projects", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-db-manager-"));
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  const manager = new DatabaseManager({ agentDir, registry });

  const handles = await manager.ensureInitialized(createCtx(cwd, false));

  assert.equal(existsSync(join(root, "home", ".pi", "pi-ext.db")), true);
  assert.equal(existsSync(join(root, "project", ".pi", "pi-ext.db")), false);
  assert.equal(handles.project, undefined);

  await manager.destroy();
});
```

- [ ] **Step 2: Implement core model and migrations**

Create `src/core/database/core-models.ts`:

```ts
import type { Generated, Kysely } from "kysely";
import { sql } from "kysely";
import type { DatabaseMigrationRegistry } from "./registry";
import { defineTableModel } from "./schema";

export interface CoreMetadataTable {
  key: string;
  value: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

declare module "./schema" {
  interface GlobalDatabase {
    pi_ext_metadata: CoreMetadataTable;
  }

  interface ProjectDatabase {
    pi_ext_project_metadata: CoreMetadataTable;
  }
}

export const globalCoreMetadataModel = defineTableModel({ scope: "global", tableName: "pi_ext_metadata" });
export const projectCoreMetadataModel = defineTableModel({ scope: "project", tableName: "pi_ext_project_metadata" });

export function registerCoreDatabaseMigrations(registry: DatabaseMigrationRegistry): void {
  registry.register("global", "core", {
    "0001_create_metadata": {
      up: async (db: Kysely<any>) => createMetadataTable(db, "pi_ext_metadata"),
      down: async (db: Kysely<any>) => dropTable(db, "pi_ext_metadata"),
    },
  });

  registry.register("project", "core", {
    "0001_create_project_metadata": {
      up: async (db: Kysely<any>) => createMetadataTable(db, "pi_ext_project_metadata"),
      down: async (db: Kysely<any>) => dropTable(db, "pi_ext_project_metadata"),
    },
  });
}

async function createMetadataTable(db: Kysely<any>, tableName: string): Promise<void> {
  await db.schema
    .createTable(tableName)
    .ifNotExists()
    .addColumn("key", "text", (col) => col.primaryKey().notNull())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updated_at", "text", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();
}

async function dropTable(db: Kysely<any>, tableName: string): Promise<void> {
  await db.schema.dropTable(tableName).ifExists().execute();
}
```

- [ ] **Step 3: Implement manager**

Create `src/core/database/manager.ts`:

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Migrator } from "kysely/migration";
import { openSqliteDatabase, type OpenedSqliteDatabase } from "./connection";
import { resolveGlobalDatabasePath, resolveProjectDatabasePath } from "./paths";
import type { DatabaseMigrationRegistry } from "./registry";

export interface DatabaseManagerOptions {
  agentDir: string;
  registry: DatabaseMigrationRegistry;
}

export interface PiExtDatabaseHandles {
  global: OpenedSqliteDatabase<"global">;
  project?: OpenedSqliteDatabase<"project">;
}

export class DatabaseManager {
  private handles: PiExtDatabaseHandles | undefined;
  private cacheKey: string | undefined;

  constructor(private readonly options: DatabaseManagerOptions) {}

  async ensureInitialized(ctx: ExtensionContext): Promise<PiExtDatabaseHandles> {
    const projectTrusted = typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
    const key = `${this.options.agentDir}\n${ctx.cwd}\n${projectTrusted}`;
    if (this.handles && this.cacheKey === key) return this.handles;

    await this.destroy();

    const global = openSqliteDatabase("global", resolveGlobalDatabasePath(this.options.agentDir));
    await this.migrate(global);

    const project = projectTrusted ? openSqliteDatabase("project", resolveProjectDatabasePath(ctx.cwd)) : undefined;
    if (project) await this.migrate(project);

    this.handles = { global, ...(project ? { project } : {}) };
    this.cacheKey = key;
    return this.handles;
  }

  async destroy(): Promise<void> {
    const current = this.handles;
    this.handles = undefined;
    this.cacheKey = undefined;
    await current?.project?.destroy();
    await current?.global.destroy();
  }

  private async migrate(handle: OpenedSqliteDatabase<any>): Promise<void> {
    const migrator = new Migrator({
      db: handle.db,
      provider: this.options.registry.createProvider(handle.scope),
      migrationTableName: "pi_ext_migration",
      migrationLockTableName: "pi_ext_migration_lock",
    });
    const { error } = await migrator.migrateToLatest();
    if (error) throw error;
  }
}
```

- [ ] **Step 4: Run manager tests**

Run:

```bash
node --import tsx --test tests/core/database/manager.test.ts
```

Expected: PASS.

---

## Task 5: Wire Database Registration into Core and Modules

**Files:**
- Modify: `src/core/modules.ts`
- Modify: `src/index.ts`
- Create tests or extend: `tests/core/runtime.test.ts` or `tests/core/database/startup.test.ts`

- [ ] **Step 1: Extend `ModuleApi`**

Modify `src/core/modules.ts` so modules can register migrations and fetch DB handles:

```ts
import type { PiExtDatabaseHandles } from "./database/manager";
import type { MigrationMap } from "./database/registry";
import type { DatabaseScope } from "./database/schema";

export interface ModuleApi {
  pi: ExtensionAPI;
  getRuntime(ctx: ExtensionContext): PiExtRuntime;
  getDatabases(ctx: ExtensionContext): Promise<PiExtDatabaseHandles>;
  registerDatabaseMigrations(scope: DatabaseScope, moduleId: ModuleId | "core", migrations: MigrationMap): void;
  isEnabled(ctx: ExtensionContext, moduleId: ModuleId): boolean;
  onRuntimeReload(listener: RuntimeReloadListener): void;
}
```

- [ ] **Step 2: Wire manager in `src/index.ts`**

Add this flow:

```ts
const migrationRegistry = new DatabaseMigrationRegistry();
registerCoreDatabaseMigrations(migrationRegistry);
const databaseManager = new DatabaseManager({ agentDir: getAgentDir(), registry: migrationRegistry });

const moduleApi = {
  pi,
  getRuntime: runtime.load,
  getDatabases: (ctx: ExtensionContext) => databaseManager.ensureInitialized(ctx),
  registerDatabaseMigrations: (scope: DatabaseScope, moduleId: ModuleId | "core", migrations: MigrationMap) => {
    migrationRegistry.register(scope, moduleId, migrations);
  },
  isEnabled(ctx: ExtensionContext, moduleId: ModuleId): boolean { ... },
  onRuntimeReload: runtime.onReload,
};
```

Then update startup handlers:

```ts
pi.on("session_start", async (_event, ctx) => {
  runtime.reload(ctx);
  await databaseManager.ensureInitialized(ctx);
});

pi.on("session_tree", async (_event, ctx) => {
  runtime.reload(ctx);
  await databaseManager.ensureInitialized(ctx);
});

pi.on("session_shutdown", async () => {
  await databaseManager.destroy();
});
```

- [ ] **Step 3: Make module registration order explicit**

Ensure all module `register(api)` calls happen before any startup migration event can fire. Keep this order in `src/index.ts`:

```ts
registerPiExtCommands(pi, runtime);
dcpModule.register(moduleApi);

pi.on("session_start", ...);
```

- [ ] **Step 4: Run compile checks**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 6: Add an Example Module Migration Test Without Shipping Unused DCP Tables

**Files:**
- Create: `tests/core/database/module-migrations.test.ts`

- [ ] **Step 1: Write a synthetic module migration test**

Create a test that registers a fake project migration and verifies it runs:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Kysely } from "kysely";
import { registerCoreDatabaseMigrations } from "../../../src/core/database/core-models";
import { DatabaseManager } from "../../../src/core/database/manager";
import { DatabaseMigrationRegistry } from "../../../src/core/database/registry";

function createCtx(cwd: string): any {
  return { cwd, isProjectTrusted: () => true };
}

test("module-owned project migrations run on startup initialization", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-module-migrations-"));
  const agentDir = join(root, ".pi", "agent");
  const registry = new DatabaseMigrationRegistry();
  registerCoreDatabaseMigrations(registry);
  registry.register("project", "dcp", {
    "0001_create_test_table": {
      up: async (db: Kysely<any>) => {
        await db.schema.createTable("dcp_test_table").addColumn("id", "integer", (col) => col.primaryKey()).execute();
      },
      down: async (db: Kysely<any>) => {
        await db.schema.dropTable("dcp_test_table").ifExists().execute();
      },
    },
  });

  const manager = new DatabaseManager({ agentDir, registry });
  const handles = await manager.ensureInitialized(createCtx(root));

  const rows = await handles.project!.db.selectFrom("dcp_test_table").select("id").execute();
  assert.deepEqual(rows, []);

  await manager.destroy();
});
```

- [ ] **Step 2: Run module migration test**

Run:

```bash
node --import tsx --test tests/core/database/module-migrations.test.ts
```

Expected: PASS.

---

## Task 7: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Leave unchanged: `config/pi-ext.example.jsonc` because this plan adds no user-configurable database settings.

- [ ] **Step 1: Document database locations and module model pattern**

Add a README section:

```md
## SQLite storage

`@voidrot/pi-ext` uses SQLite through Kysely for extension-owned persistent state.

- Global database: `~/.pi/pi-ext.db`
- Project database: `.pi/pi-ext.db` in trusted projects

Core and modules register migrations at extension startup. Table model files declare whether a table belongs to the global or project database by augmenting `GlobalDatabase` or `ProjectDatabase` from `src/core/database/schema.ts` and exporting a `defineTableModel({ scope, tableName })` descriptor.
```

- [ ] **Step 2: Run full validation**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all PASS.

- [ ] **Step 3: Manual smoke check in Pi**

Start Pi in a trusted project with the extension installed, then verify files exist:

```bash
test -f ~/.pi/pi-ext.db
test -f .pi/pi-ext.db
```

Expected: both commands exit 0 for trusted projects.

---

## Acceptance Criteria

- `kysely`, `better-sqlite3`, and `@types/better-sqlite3` are installed and typecheck cleanly.
- Global migrations create `~/.pi/pi-ext.db` and core global metadata table.
- Trusted project migrations create `.pi/pi-ext.db` and core project metadata table.
- Untrusted projects do not get `.pi/pi-ext.db` unless the trust decision is intentionally changed.
- Modules can register global or project migrations through `ModuleApi`.
- Model files can express DB scope with `GlobalDatabase`/`ProjectDatabase` augmentation plus `defineTableModel({ scope, tableName })`.
- Startup handlers run migrations idempotently for both available scopes.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
