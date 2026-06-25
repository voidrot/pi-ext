# Add background dashboard webserver module

## Goal

Add a first-class `dashboard` module that starts a local background HTTP server when a Pi session starts, opens the user’s browser to the exact `http://localhost:<assigned-port>/` URL for that running server, and serves useful placeholder content today.

The initial page should show extension/runtime health and local storage paths. The design must leave a clean path for future pages/API endpoints that expose DCP statistics from both the global SQLite database (`~/.pi/pi-ext.db`) and the trusted project SQLite database (`.pi/pi-ext.db`).

## Architecture

- Add a new module id: `dashboard`.
- Add dashboard configuration under `modules.dashboard`.
- Use Node built-ins only for the first version:
  - `node:http` for the background webserver.
  - `node:child_process` for opening the system browser.
  - `node:crypto` for an instance id.
- Bind to loopback by default (`127.0.0.1`) to avoid exposing extension state on the network.
- Start one dashboard server per extension process.
- Reuse the running server across `session_tree` reloads unless dashboard config changes.
- Open the browser after the server is actually listening and after the assigned port is known.
- Store the latest Pi session context snapshot in the dashboard runtime so HTTP handlers can show the current cwd/trust/runtime/database status.
- Stop the server on `session_shutdown`.

## Tech stack

- TypeScript ESM
- Node `http.Server`
- Existing Pi extension event APIs
- Existing `ModuleApi.getRuntime(ctx)` and `ModuleApi.getDatabases(ctx)`
- Existing config loader/schema/example pipeline
- Node test runner + `tsx`

## Configuration design

Add this default config:

```ts
export interface DashboardModuleConfig {
  enabled: boolean;
  server: {
    host: string;
    port: number | "auto";
    portRange: {
      start: number;
      end: number;
    };
  };
  browser: {
    openOnStart: boolean;
    reopenOnSessionChange: boolean;
  };
}

export const defaultDashboardModuleConfig: DashboardModuleConfig = {
  enabled: true,
  server: {
    host: "127.0.0.1",
    port: "auto",
    portRange: {
      start: 17380,
      end: 17480,
    },
  },
  browser: {
    openOnStart: true,
    reopenOnSessionChange: false,
  },
};
```

Behavior:

- `enabled: false` prevents server start and browser opening.
- `server.port: "auto"` scans `portRange.start` through `portRange.end` and picks the first available port.
- `server.port: <number>` attempts that exact port and fails with a logged warning if unavailable.
- `browser.openOnStart: false` starts the server silently.
- `browser.reopenOnSessionChange: false` avoids opening a new browser tab on every `session_tree` update.

## Routes in the first implementation

- `GET /`
  - Returns a complete HTML page.
  - Shows placeholder dashboard cards:
    - Dashboard instance id
    - Server URL
    - Current project cwd
    - Project trusted/untrusted status
    - Global database path
    - Project database path if trusted
    - Enabled extension modules
    - Links to `/api/status` and `/healthz`
- `GET /api/status`
  - Returns JSON for future frontend/data work.
- `GET /healthz`
  - Returns `ok` as `text/plain`.
- Everything else returns `404`.

Example status payload shape:

```ts
interface DashboardStatusPayload {
  dashboard: {
    instanceId: string;
    startedAt: string;
    url: string;
    host: string;
    port: number;
  };
  session: {
    cwd: string;
    projectTrusted: boolean;
    sessionFile?: string;
  };
  runtime: {
    debug: boolean;
    enabled: boolean;
    modules: {
      dcp: boolean;
      dashboard: boolean;
    };
  };
  database: {
    global: {
      path: string;
    };
    project?: {
      path: string;
    };
  };
}
```

## Files to add

```text
src/core/browser.ts
src/modules/dashboard/index.ts
src/modules/dashboard/render.ts
src/modules/dashboard/server.ts
tests/core/browser.test.ts
tests/modules/dashboard/render.test.ts
tests/modules/dashboard/server.test.ts
tests/modules/dashboard/module.test.ts
```

## Files to modify

```text
src/core/config.ts
src/core/modules.ts
src/index.ts
config/pi-ext.schema.json
config/pi-ext.example.jsonc
README.md
```

## TDD implementation plan

### 1. Add dashboard config defaults and merging

Failing tests first:

- Update existing config tests to expect `modules.dashboard` in defaults.
- Add tests that partial dashboard config merges deeply:
  - global config can set `modules.dashboard.browser.openOnStart: false` without losing default server settings.
  - project config can override `modules.dashboard.server.port` without losing default browser settings.

Implementation:

- Add `DashboardModuleConfig` and `defaultDashboardModuleConfig` in `src/core/config.ts`.
- Extend `PiExtConfig.modules` with `dashboard`.
- Extend config normalization to merge `dashboard` the same way DCP is merged.
- Add dashboard config to `config/pi-ext.schema.json`.
- Add dashboard config to `config/pi-ext.example.jsonc`.

### 2. Extend module ids

Failing tests first:

- Add a small type-level/runtime test where useful, or let `typecheck` fail until all references compile.

Implementation:

```ts
export type ModuleId = "dcp" | "dashboard";
```

No `ModuleApi` changes are needed for the first version because the dashboard module can use existing APIs:

- `api.getRuntime(ctx)`
- `api.getDatabases(ctx)`
- `api.isEnabled(ctx, "dashboard")`
- `api.onRuntimeReload(listener)`

### 3. Add injectable browser opener

Failing tests first in `tests/core/browser.test.ts`:

- Linux uses `xdg-open <url>`.
- macOS uses `open <url>`.
- Windows uses `cmd /c start "" <url>`.
- Spawn errors reject the returned promise.

Implementation in `src/core/browser.ts`:

```ts
export interface BrowserOpenOptions {
  platform?: NodeJS.Platform;
  spawn?: typeof import("node:child_process").spawn;
}

export type BrowserOpener = (url: string) => Promise<void>;

export function createSystemBrowserOpener(options?: BrowserOpenOptions): BrowserOpener;
export const openUrlInBrowser: BrowserOpener;
```

The dashboard module will accept a `BrowserOpener` dependency in tests, so tests never launch a real browser.

### 4. Add the HTTP server runtime

Failing tests first in `tests/modules/dashboard/server.test.ts`:

- Starts on an available auto-selected port and exposes the final URL.
- Returns `GET /healthz` = `200 ok`.
- Returns `GET /api/status` JSON with the latest snapshot.
- Returns `GET /` HTML containing the current cwd and database paths.
- Returns 404 for unknown paths.
- `stop()` closes the port.
- Calling `start()` twice reuses the same server and port.
- Configured occupied port fails cleanly.
- Auto mode skips an occupied port inside the configured range.

Implementation in `src/modules/dashboard/server.ts`:

- `DashboardServer` owns `http.Server | undefined`.
- `DashboardServer.start(snapshot)` starts only once and returns a state object.
- `DashboardServer.updateSnapshot(snapshot)` updates the data used by request handlers.
- `DashboardServer.stop()` closes the server and clears state.
- Port selection listens on the actual chosen port before returning the URL.

### 5. Add rendering helpers

Failing tests first in `tests/modules/dashboard/render.test.ts`:

- `renderDashboardHtml(status)` escapes HTML in cwd/session values.
- `renderDashboardHtml(status)` includes links to `/api/status` and `/healthz`.
- `createDashboardStatus(...)` includes global DB info and omits project DB info when project DB is unavailable.

Implementation in `src/modules/dashboard/render.ts`:

- Keep HTML server-rendered for the initial placeholder version.
- Include a tiny inline CSS block; no external assets.
- Escape all dynamic strings.
- Keep JSON payload and HTML generated from the same status object.

### 6. Add dashboard module lifecycle

Failing tests first in `tests/modules/dashboard/module.test.ts` using a fake Pi API:

- Registers handlers for `session_start`, `session_tree`, and `session_shutdown`.
- Does not start when `modules.dashboard.enabled` is false.
- On `session_start`, starts the server and opens the browser once when `openOnStart` is true.
- On `session_tree`, updates the snapshot but does not reopen the browser by default.
- With `reopenOnSessionChange: true`, opens on session changes after start.
- On `session_shutdown`, stops the server.
- Logs/continues if browser opening fails after server start.

Implementation in `src/modules/dashboard/index.ts`:

- Export `dashboardModule`.
- Internally create a `DashboardServer` and use `openUrlInBrowser` by default.
- Use `api.isEnabled(ctx, "dashboard")` before start/update.
- Build the snapshot from:
  - `ctx.cwd`
  - `ctx.projectTrusted`
  - `api.getRuntime(ctx)`
  - `api.getDatabases(ctx)`
- Register a command such as `pi-ext.dashboard.open` to manually open the current dashboard URL, if command registration shape matches existing command helpers.

### 7. Wire the module into extension startup

Failing tests/validation first:

- `npm run typecheck` should fail until imports/module id wiring are complete.

Implementation in `src/index.ts`:

- Import `dashboardModule`.
- Register both modules:

```ts
for (const module of [dcpModule, dashboardModule]) {
  module.register(moduleApi);
}
```

- Keep the existing top-level `session_start` and `session_tree` handlers that reload runtime and initialize databases.
- Because Pi event ordering may matter, the dashboard module should call `api.getRuntime(ctx)` and `api.getDatabases(ctx)` itself rather than assuming another handler already initialized them.

### 8. Update docs

Add README documentation:

- Dashboard is enabled by default.
- It binds to `127.0.0.1`.
- Browser opens on session start.
- Config example for fixed port and silent start:

```jsonc
{
  "modules": {
    "dashboard": {
      "enabled": true,
      "server": {
        "host": "127.0.0.1",
        "port": 17380
      },
      "browser": {
        "openOnStart": false,
        "reopenOnSessionChange": false
      }
    }
  }
}
```

## Security and safety notes

- Default host must be `127.0.0.1`, not `0.0.0.0`.
- The module should not enable CORS.
- The browser opener only opens URLs generated by the dashboard server.
- The page must HTML-escape all dynamic values.
- Browser-open failures should warn but not fail extension startup.
- Server startup failures should warn and leave the extension usable.

## Validation checklist

Run after implementation:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke test:

1. Start Pi with the extension installed.
2. Confirm the browser opens to `http://127.0.0.1:<port>/`.
3. Confirm `/healthz` returns `ok`.
4. Confirm `/api/status` shows global DB path and project DB path in a trusted project.
5. Confirm disabling `modules.dashboard.enabled` prevents server startup.
6. Confirm `browser.openOnStart: false` starts the server without opening a browser.

## Future follow-ups

After the placeholder dashboard lands:

1. Add a DCP stats provider that queries DCP tables from global/project SQLite databases.
2. Add `/api/dcp/stats` with explicit global/project sections.
3. Add a small client-side enhancement for auto-refreshing stats.
4. Add a module-level data provider registry if more modules need to contribute dashboard panels.
5. Consider an optional random local token in the URL if the dashboard begins exposing sensitive data.
