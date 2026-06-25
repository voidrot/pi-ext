# Dashboard Memory View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard memory page where stored memories can be browsed in a combined view and in separate global, project, and session views.

**Architecture:** Keep memory storage reads in `src/modules/memory/repository.ts`, add a dashboard-facing memory payload builder in `src/modules/dashboard/memories.ts`, and have dashboard routes query the current databases on each HTTP request so the page reflects newly-created memories without restarting the server. Render `/memories` as the combined view and `/memories/global`, `/memories/project`, `/memories/session` as scoped views, with matching JSON APIs.

**Tech Stack:** TypeScript, Hono, Hono JSX server rendering, Kysely/SQLite, Node test runner, existing shadcn-style dashboard UI helpers.

---

## File Structure

- Modify: `src/modules/memory/repository.ts` — add `listStoredMemories()` for dashboard browsing, independent from prompt-injection limits.
- Create: `src/modules/dashboard/memories.ts` — convert repository memory lists into dashboard payloads with combined/global/project/session collections and empty/unavailable messages.
- Modify: `src/modules/dashboard/server.ts` — add async memory data provider routes for HTML and JSON memory views.
- Modify: `src/modules/dashboard/index.ts` — pass a provider that queries current runtime databases/session id to the dashboard server.
- Modify: `src/modules/dashboard/render.tsx` — add navigation link from dashboard home to memories and export shared page styling constants.
- Create: `src/modules/dashboard/memory-render.tsx` — render memory list pages using the shared dashboard visual system.
- Modify: `tests/modules/memory/repository.test.ts` — cover dashboard memory listing order, scope separation, and untrusted/no-project behavior.
- Create: `tests/modules/dashboard/memories.test.ts` — cover dashboard payload shaping and combined ordering.
- Modify: `tests/modules/dashboard/server.test.ts` — cover `/memories`, scoped memory pages, and `/api/memories` routes.
- Modify: `tests/modules/dashboard/module.test.ts` — cover that the module server receives a request-time memory provider.

## Route/API Contract

- `GET /memories` renders the combined memory view.
- `GET /memories/global` renders only global memories.
- `GET /memories/project` renders only project memories, with an explanatory empty state if no trusted project database exists.
- `GET /memories/session` renders only current-session memories, with an explanatory empty state if no session id/file is available or no trusted project database exists.
- `GET /api/memories` returns the full payload: `{ combined, global, project, session, unavailable }`.
- `GET /api/memories/:scope` returns one scope where `scope` is `combined | global | project | session`.

## Task 1: Add repository listing for stored memories

**Files:**
- Modify: `src/modules/memory/repository.ts`
- Modify: `tests/modules/memory/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add this import to `tests/modules/memory/repository.test.ts`:

```ts
import {
  completeMemoryVectorJob,
  createGlobalMemory,
  createProjectMemory,
  listMemoriesForPrompt,
  listPendingMemoryVectorJobs,
  listStoredMemories,
  searchMemoriesByText,
} from "../../../src/modules/memory/repository";
```

Add this test at the end of the file:

```ts
test("lists stored memories for dashboard by scope", async () => {
  const { manager, handles } = await createHandles();

  const global = await createGlobalMemory(handles.global.db, {
    content: "Global dashboard memory.",
    title: "Global",
    tags: ["dashboard"],
    importance: 2,
  });
  const project = await createProjectMemory(handles.project!.db, {
    scope: "project",
    content: "Project dashboard memory.",
    title: "Project",
    tags: ["dashboard"],
    importance: 4,
  });
  const session = await createProjectMemory(handles.project!.db, {
    scope: "session",
    sessionId: "session-1",
    content: "Session dashboard memory.",
    title: "Session",
    tags: ["dashboard"],
    importance: 5,
  });
  await createProjectMemory(handles.project!.db, {
    scope: "session",
    sessionId: "other-session",
    content: "Hidden session memory.",
  });

  const listed = await listStoredMemories(handles, { sessionId: "session-1", limitPerScope: 50 });

  assert.deepEqual(listed.global.map((item) => item.id), [global.id]);
  assert.deepEqual(listed.project.map((item) => item.id), [project.id]);
  assert.deepEqual(listed.session.map((item) => item.id), [session.id]);

  await manager.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/modules/memory/repository.test.ts
```

Expected: FAIL because `listStoredMemories` is not exported.

- [ ] **Step 3: Implement repository listing**

In `src/modules/memory/repository.ts`, add this function after `listMemoriesForPrompt()`:

```ts
export async function listStoredMemories(
  handles: PiExtDatabaseHandles,
  options: { sessionId?: string; limitPerScope: number },
): Promise<PromptMemoryList> {
  const limit = normalizeStoredMemoryLimit(options.limitPerScope);

  const globalRows = await handles.global.db
    .selectFrom("pi_ext_global_memories")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();

  const projectRows = handles.project
    ? await handles.project.db
      .selectFrom("pi_ext_project_memories")
      .selectAll()
      .where("scope", "=", "project")
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute()
    : [];

  const sessionRows = handles.project && options.sessionId
    ? await handles.project.db
      .selectFrom("pi_ext_project_memories")
      .selectAll()
      .where("scope", "=", "session")
      .where("session_id", "=", options.sessionId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute()
    : [];

  return {
    global: globalRows.map(mapGlobalRow),
    project: projectRows.map(mapProjectRow),
    session: sessionRows.map(mapProjectRow),
  };
}
```

Add this helper near `normalizeJobLimit()`:

```ts
function normalizeStoredMemoryLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 500) : 100;
}
```

- [ ] **Step 4: Run repository tests**

Run:

```bash
npm test -- tests/modules/memory/repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/repository.ts tests/modules/memory/repository.test.ts
git commit -m "feat(memory): list stored memories for dashboard"
```

## Task 2: Build dashboard memory payloads

**Files:**
- Create: `src/modules/dashboard/memories.ts`
- Create: `tests/modules/dashboard/memories.test.ts`

- [ ] **Step 1: Write failing payload tests**

Create `tests/modules/dashboard/memories.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardMemoriesPayload } from "../../../src/modules/dashboard/memories";
import type { PromptMemoryList } from "../../../src/modules/memory/repository";

const memories: PromptMemoryList = {
  global: [{ id: "g1", scope: "global", content: "Global", tags: [], importance: 3, createdAt: "2026-06-24 12:00:00", updatedAt: "2026-06-24 12:00:00" }],
  project: [{ id: "p1", scope: "project", content: "Project", tags: ["repo"], importance: 4, createdAt: "2026-06-24 12:01:00", updatedAt: "2026-06-24 12:01:00" }],
  session: [{ id: "s1", scope: "session", sessionId: "session-1", content: "Session", tags: [], importance: 5, createdAt: "2026-06-24 12:02:00", updatedAt: "2026-06-24 12:02:00" }],
};

test("creates combined and scoped dashboard memory payload", () => {
  const payload = createDashboardMemoriesPayload(memories, { hasProjectDatabase: true, hasSessionId: true });

  assert.deepEqual(payload.combined.map((item) => item.id), ["s1", "p1", "g1"]);
  assert.equal(payload.global[0].source, "global");
  assert.equal(payload.project[0].source, "project");
  assert.equal(payload.session[0].sessionId, "session-1");
  assert.deepEqual(payload.unavailable, {});
});

test("explains unavailable project and session memories", () => {
  const payload = createDashboardMemoriesPayload({ global: memories.global, project: [], session: [] }, {
    hasProjectDatabase: false,
    hasSessionId: false,
  });

  assert.equal(payload.unavailable.project, "Project memories require a trusted project database.");
  assert.equal(payload.unavailable.session, "Session memories require a trusted project database and an active session id.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/modules/dashboard/memories.test.ts
```

Expected: FAIL because `src/modules/dashboard/memories.ts` does not exist.

- [ ] **Step 3: Implement payload builder**

Create `src/modules/dashboard/memories.ts`:

```ts
import type { MemoryRecord, PromptMemoryList } from "../memory/repository";

export type DashboardMemoryScope = "combined" | "global" | "project" | "session";

export interface DashboardMemoryRecord extends MemoryRecord {
  source: "global" | "project";
}

export interface DashboardMemoriesPayload {
  combined: DashboardMemoryRecord[];
  global: DashboardMemoryRecord[];
  project: DashboardMemoryRecord[];
  session: DashboardMemoryRecord[];
  unavailable: {
    project?: string;
    session?: string;
  };
}

export interface DashboardMemoriesPayloadOptions {
  hasProjectDatabase: boolean;
  hasSessionId: boolean;
}

export function createDashboardMemoriesPayload(
  memories: PromptMemoryList,
  options: DashboardMemoriesPayloadOptions,
): DashboardMemoriesPayload {
  const global = memories.global.map((memory) => toDashboardMemory(memory, "global"));
  const project = memories.project.map((memory) => toDashboardMemory(memory, "project"));
  const session = memories.session.map((memory) => toDashboardMemory(memory, "project"));
  const combined = [...global, ...project, ...session].toSorted(compareDashboardMemoryRecords);

  return {
    combined,
    global,
    project,
    session,
    unavailable: {
      ...(!options.hasProjectDatabase ? { project: "Project memories require a trusted project database." } : {}),
      ...(!options.hasProjectDatabase || !options.hasSessionId
        ? { session: "Session memories require a trusted project database and an active session id." }
        : {}),
    },
  };
}

export function selectDashboardMemoryScope(payload: DashboardMemoriesPayload, scope: DashboardMemoryScope): DashboardMemoryRecord[] {
  return payload[scope];
}

function toDashboardMemory(memory: MemoryRecord, source: "global" | "project"): DashboardMemoryRecord {
  return { ...memory, source };
}

function compareDashboardMemoryRecords(left: DashboardMemoryRecord, right: DashboardMemoryRecord): number {
  const byCreatedAt = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (Number.isFinite(byCreatedAt) && byCreatedAt !== 0) return byCreatedAt;
  return right.importance - left.importance;
}
```

- [ ] **Step 4: Run payload tests**

Run:

```bash
npm test -- tests/modules/dashboard/memories.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/memories.ts tests/modules/dashboard/memories.test.ts
git commit -m "feat(dashboard): shape memory view payloads"
```

## Task 3: Render memory pages

**Files:**
- Modify: `src/modules/dashboard/render.tsx`
- Create: `src/modules/dashboard/memory-render.tsx`
- Modify: `tests/modules/dashboard/render.test.ts`

- [ ] **Step 1: Write failing render expectations**

In `tests/modules/dashboard/render.test.ts`, import the new renderer:

```ts
import { renderDashboardMemoryHtml } from "../../../src/modules/dashboard/memory-render";
```

Add this test:

```ts
test("renders combined and scoped memory pages with escaped content", () => {
  const html = renderDashboardMemoryHtml({
    scope: "combined",
    memories: {
      combined: [{ id: "g1", source: "global", scope: "global", title: "Unsafe <title>", content: "Remember <script>bad</script>", tags: ["x"], importance: 3, createdAt: "2026-06-24 12:00:00", updatedAt: "2026-06-24 12:00:00" }],
      global: [],
      project: [],
      session: [],
      unavailable: {},
    },
  });

  assert.match(html, /Stored Memories/);
  assert.match(html, /href="\/memories\/global"/);
  assert.match(html, /Unsafe &lt;title&gt;/);
  assert.match(html, /Remember &lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/modules/dashboard/render.test.ts
```

Expected: FAIL because `memory-render.tsx` does not exist.

- [ ] **Step 3: Export shared style constants and add home link**

In `src/modules/dashboard/render.tsx`:

- Change `const tailwindStyleAttributes` to `export const tailwindStyleAttributes`.
- Change `const tailwindTheme` to `export const tailwindTheme`.
- Add a link beside JSON status and health check:

```tsx
<ButtonLink href="/memories" variant="outline">
  Stored memories
</ButtonLink>
```

- [ ] **Step 4: Create memory renderer**

Create `src/modules/dashboard/memory-render.tsx`:

```tsx
import { renderToString } from "hono/jsx/dom/server";
import { Badge, ButtonLink, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from "./ui";
import { tailwindStyleAttributes, tailwindTheme } from "./render";
import { selectDashboardMemoryScope, type DashboardMemoriesPayload, type DashboardMemoryScope } from "./memories";

export interface RenderDashboardMemoryHtmlInput {
  scope: DashboardMemoryScope;
  memories: DashboardMemoriesPayload;
}

export function renderDashboardMemoryHtml(input: RenderDashboardMemoryHtmlInput): string {
  return `<!doctype html>\n${renderToString(<DashboardMemoryPage {...input} />)}`;
}

function DashboardMemoryPage(props: RenderDashboardMemoryHtmlInput) {
  const records = selectDashboardMemoryScope(props.memories, props.scope);
  const title = props.scope === "combined" ? "Stored Memories" : `${capitalize(props.scope)} Memories`;
  const emptyMessage = getEmptyMessage(props.memories, props.scope);

  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} - Pi Ext Dashboard</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <style {...tailwindStyleAttributes}>{tailwindTheme}</style>
      </head>
      <body class="min-h-screen bg-background text-foreground antialiased">
        <main class="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 lg:px-8">
          <header class="flex flex-col gap-6 rounded-3xl border bg-card px-6 py-8 shadow-sm lg:px-8">
            <div class="flex flex-col gap-3">
              <Badge variant="secondary" class="uppercase tracking-[0.24em]">Memory browser</Badge>
              <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div class="flex max-w-3xl flex-col gap-3">
                  <h1 class="text-4xl font-semibold tracking-[-0.06em] text-balance sm:text-6xl">{title}</h1>
                  <p class="text-muted-foreground text-base leading-7 sm:text-lg">
                    Browse saved Pi Ext memories across global, project, and current-session scopes.
                  </p>
                </div>
                <div class="flex flex-wrap gap-3">
                  <ButtonLink href="/" variant="secondary">Dashboard</ButtonLink>
                  <ButtonLink href="/api/memories" variant="outline">JSON memories</ButtonLink>
                </div>
              </div>
            </div>
            <Separator />
            <nav class="flex flex-wrap gap-3">
              <MemoryTab href="/memories" label="Combined" active={props.scope === "combined"} />
              <MemoryTab href="/memories/global" label="Global" active={props.scope === "global"} />
              <MemoryTab href="/memories/project" label="Project" active={props.scope === "project"} />
              <MemoryTab href="/memories/session" label="Session" active={props.scope === "session"} />
            </nav>
          </header>

          {records.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No memories found</CardTitle>
                <CardDescription>{emptyMessage}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <section class="grid gap-4">
              {records.map((memory) => <MemoryCard memory={memory} />)}
            </section>
          )}
        </main>
      </body>
    </html>
  );
}

function MemoryTab(props: { href: string; label: string; active: boolean }) {
  return <ButtonLink href={props.href} variant={props.active ? "secondary" : "outline"}>{props.label}</ButtonLink>;
}

function MemoryCard(props: { memory: import("./memories").DashboardMemoryRecord }) {
  const { memory } = props;
  return (
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <span>{memory.scope}</span>
          <span>importance {memory.importance}</span>
          <span>{memory.createdAt}</span>
        </div>
        <CardTitle>{memory.title ?? memory.id}</CardTitle>
        <CardDescription>{memory.id}{memory.sessionId ? ` · session ${memory.sessionId}` : ""}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <p class="whitespace-pre-wrap text-sm leading-6 text-card-foreground">{memory.content}</p>
        {memory.tags.length > 0 ? <p class="text-xs text-muted-foreground">tags: {memory.tags.join(", ")}</p> : null}
      </CardContent>
    </Card>
  );
}

function getEmptyMessage(payload: DashboardMemoriesPayload, scope: DashboardMemoryScope): string {
  if (scope === "project" && payload.unavailable.project) return payload.unavailable.project;
  if (scope === "session" && payload.unavailable.session) return payload.unavailable.session;
  return "No stored memories are available for this view.";
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
```

- [ ] **Step 5: Run render tests**

Run:

```bash
npm test -- tests/modules/dashboard/render.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard/render.tsx src/modules/dashboard/memory-render.tsx tests/modules/dashboard/render.test.ts
git commit -m "feat(dashboard): render stored memory pages"
```

## Task 4: Add dashboard memory routes and provider

**Files:**
- Modify: `src/modules/dashboard/server.ts`
- Modify: `src/modules/dashboard/index.ts`
- Modify: `tests/modules/dashboard/server.test.ts`
- Modify: `tests/modules/dashboard/module.test.ts`

- [ ] **Step 1: Write failing server route tests**

In `tests/modules/dashboard/server.test.ts`, import the payload type if needed and update the first `createDashboardApp` call with a `getMemories` provider:

```ts
getMemories: async () => ({
  combined: [{ id: "g1", source: "global", scope: "global", content: "Global memory", tags: [], importance: 3, createdAt: "2026-06-24 12:00:00", updatedAt: "2026-06-24 12:00:00" }],
  global: [{ id: "g1", source: "global", scope: "global", content: "Global memory", tags: [], importance: 3, createdAt: "2026-06-24 12:00:00", updatedAt: "2026-06-24 12:00:00" }],
  project: [],
  session: [],
  unavailable: {},
}),
```

Add route assertions in that test:

```ts
const memoriesJson = await app.request("/api/memories");
assert.equal(memoriesJson.status, 200);
assert.equal(((await memoriesJson.json()) as any).combined[0].content, "Global memory");

const scopedJson = await app.request("/api/memories/global");
assert.equal(scopedJson.status, 200);
assert.equal(((await scopedJson.json()) as any).scope, "global");

const memoryPage = await app.request("/memories");
assert.equal(memoryPage.status, 200);
assert.match(await memoryPage.text(), /Global memory/);

const globalPage = await app.request("/memories/global");
assert.equal(globalPage.status, 200);
assert.match(await globalPage.text(), /Global Memories/);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/modules/dashboard/server.test.ts
```

Expected: FAIL because `createDashboardApp` does not accept or route `getMemories`.

- [ ] **Step 3: Implement Hono routes**

In `src/modules/dashboard/server.ts`:

- Import memory renderer/types:

```ts
import { type DashboardMemoriesPayload, type DashboardMemoryScope } from "./memories";
import { renderDashboardMemoryHtml } from "./memory-render";
```

- Replace `DashboardAppOptions` with:

```ts
export interface DashboardAppOptions {
  getStatus: () => DashboardStatusPayload;
  getMemories: () => Promise<DashboardMemoriesPayload>;
}
```

- Add routes before `notFound`:

```ts
  app.get("/api/memories", async (c) => {
    const memories = await options.getMemories();
    return c.body(JSON.stringify(memories), 200, { "content-type": "application/json; charset=utf-8" });
  });

  app.get("/api/memories/:scope", async (c) => {
    const scope = parseDashboardMemoryScope(c.req.param("scope"));
    if (!scope) return c.body(JSON.stringify({ error: "Unknown memory scope" }), 404, { "content-type": "application/json; charset=utf-8" });
    const memories = await options.getMemories();
    return c.body(JSON.stringify({ scope, memories: memories[scope] }), 200, { "content-type": "application/json; charset=utf-8" });
  });

  app.get("/memories", async (c) => c.html(renderDashboardMemoryHtml({ scope: "combined", memories: await options.getMemories() })));

  app.get("/memories/:scope", async (c) => {
    const scope = parseDashboardMemoryScope(c.req.param("scope"));
    if (!scope || scope === "combined") return c.text("not found", 404);
    return c.html(renderDashboardMemoryHtml({ scope, memories: await options.getMemories() }));
  });
```

- Add helper:

```ts
function parseDashboardMemoryScope(value: string): DashboardMemoryScope | undefined {
  return value === "combined" || value === "global" || value === "project" || value === "session" ? value : undefined;
}
```

- Update `DashboardServer` constructor to accept a memory provider:

```ts
export interface DashboardServerOptions {
  getMemories: () => Promise<DashboardMemoriesPayload>;
}

export class DashboardServer {
  constructor(private readonly config: DashboardServerConfig, private readonly options: DashboardServerOptions) {}
```

- Update app creation inside `start()`:

```ts
const app = createDashboardApp({ getStatus: () => this.createStatus(), getMemories: this.options.getMemories });
```

- [ ] **Step 4: Wire provider from module**

In `src/modules/dashboard/index.ts`:

- Import:

```ts
import { createDashboardMemoriesPayload } from "./memories";
import { listStoredMemories } from "../memory/repository";
```

- Update `DashboardServerLike` creation types so `createServer` receives a second provider argument:

```ts
export interface DashboardMemoryProvider {
  getMemories(): Promise<import("./memories").DashboardMemoriesPayload>;
}

export interface DashboardModuleOptions {
  createServer?: (config: DashboardServerConfig, provider: DashboardMemoryProvider) => DashboardServerLike;
  openBrowser?: BrowserOpener;
}
```

- Add `let currentCtx: ExtensionContext | undefined;` near `serverConfigKey`.
- Set `currentCtx = ctx;` at the top of `ensureServer()` after config is loaded.
- Create provider before `ensureServer`:

```ts
  const memoryProvider: DashboardMemoryProvider = {
    async getMemories() {
      if (!currentCtx) {
        return createDashboardMemoriesPayload({ global: [], project: [], session: [] }, { hasProjectDatabase: false, hasSessionId: false });
      }
      const runtime = api.getRuntime(currentCtx);
      const handles = await api.getDatabases(currentCtx);
      const sessionId = currentCtx.sessionManager.getSessionId?.();
      const memories = await listStoredMemories(handles, { sessionId, limitPerScope: 200 });
      return createDashboardMemoriesPayload(memories, { hasProjectDatabase: Boolean(handles.project), hasSessionId: Boolean(sessionId) });
    },
  };
```

- Update default server factory:

```ts
const createServer = options.createServer ?? ((config: DashboardServerConfig, provider: DashboardMemoryProvider) => new DashboardServer(config, provider));
```

- Update server creation:

```ts
server = createServer(config.server, memoryProvider);
```

- [ ] **Step 5: Run dashboard route/module tests**

Run:

```bash
npm test -- tests/modules/dashboard/server.test.ts tests/modules/dashboard/module.test.ts
```

Expected: PASS after adapting all `createDashboardApp` and `new DashboardServer` call sites to supply `getMemories`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard/server.ts src/modules/dashboard/index.ts tests/modules/dashboard/server.test.ts tests/modules/dashboard/module.test.ts
git commit -m "feat(dashboard): serve memory browser routes"
```

## Task 5: Full validation and docs note

**Files:**
- Modify: `docs/memory.md` or `README.md` if dashboard features are documented there.

- [ ] **Step 1: Run full automated checks**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands PASS.

- [ ] **Step 2: Add a short docs note**

Add to `docs/memory.md`:

```md
## Dashboard memory browser

When the dashboard module is enabled, stored memories are available at `/memories` on the local dashboard server. The page includes a combined view plus separate global, project, and current-session views. JSON is available at `/api/memories` and `/api/memories/{combined|global|project|session}`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/memory.md
git commit -m "docs(memory): document dashboard memory browser"
```

## Self-Review

- Spec coverage: The plan adds a stored memory dashboard page, a combined view, and separate global/project/session views, plus JSON APIs for testing and inspection.
- Freshness: Routes query the database through a request-time provider, so newly saved memories are visible without restarting the dashboard server.
- Scope behavior: Global reads from the global DB; project/session read from the trusted project DB; session filters to the current session id/file.
- Placeholder scan: No TBD/TODO placeholders remain; each task includes exact file paths, commands, and expected outcomes.
- Type consistency: `DashboardMemoryScope`, `DashboardMemoriesPayload`, `DashboardMemoryRecord`, and `listStoredMemories()` names are consistent across tasks.
