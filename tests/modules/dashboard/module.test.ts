import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPiExtConfig, mergePiExtConfig, type PiExtConfig } from "../../../src/core/config";
import { createDashboardModule } from "../../../src/modules/dashboard";
import type { DashboardServerConfig, DashboardServerSnapshot, DashboardServerState } from "../../../src/modules/dashboard/server";

class FakeDashboardServer {
  starts: DashboardServerSnapshot[] = [];
  updates: DashboardServerSnapshot[] = [];
  stops = 0;
  startError: Error | undefined;
  state: DashboardServerState = {
    instanceId: "fake-instance",
    startedAt: new Date("2026-06-24T12:00:00.000Z"),
    host: "127.0.0.1",
    port: 17380,
    url: "http://127.0.0.1:17380/",
  };

  async start(snapshot: DashboardServerSnapshot): Promise<DashboardServerState> {
    this.starts.push(snapshot);
    if (this.startError) throw this.startError;
    return this.state;
  }

  updateSnapshot(snapshot: DashboardServerSnapshot): void {
    this.updates.push(snapshot);
  }

  async stop(): Promise<void> {
    this.stops++;
  }

  getState(): DashboardServerState | undefined {
    return this.state;
  }
}

function createHarness(config: PiExtConfig = defaultPiExtConfig) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, unknown>();
  const servers: FakeDashboardServer[] = [];
  const opened: string[] = [];
  const warnings: unknown[] = [];

  const pi = {
    on(name: string, handler: Function) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
  };

  const module = createDashboardModule({
    createServer(_config: DashboardServerConfig) {
      const server = new FakeDashboardServer();
      servers.push(server);
      return server as never;
    },
    openBrowser: async (url: string) => {
      opened.push(url);
    },
  });

  module.register({
    pi: pi as never,
    getRuntime: () => ({
      config,
      sessionFile: "/tmp/session.json",
      logger: { warn: (message: string, data?: unknown) => warnings.push({ message, data }) } as never,
    }),
    getDatabases: async () =>
      ({
        global: { path: "/home/me/.pi/pi-ext.db" },
        project: { path: "/tmp/project/.pi/pi-ext.db" },
      }) as never,
    registerDatabaseMigrations: () => {},
    isEnabled: (_ctx: unknown, moduleId: "dcp" | "dashboard") => config.enabled && config.modules[moduleId].enabled,
    onRuntimeReload: () => {},
  });

  const ctx = {
    cwd: "/tmp/project",
    isProjectTrusted: () => true,
    sessionManager: { getSessionFile: () => "/tmp/session.json" },
  };

  return { handlers, commands, servers, opened, warnings, ctx };
}

test("registers dashboard lifecycle handlers and open command", () => {
  const harness = createHarness();

  assert.equal(typeof harness.handlers.get("session_start"), "function");
  assert.equal(typeof harness.handlers.get("session_tree"), "function");
  assert.equal(typeof harness.handlers.get("session_shutdown"), "function");
  assert.ok(harness.commands.has("dashboard"));
});

test("does not start when dashboard is disabled", async () => {
  const config = mergePiExtConfig(defaultPiExtConfig, { modules: { dashboard: { enabled: false } } });
  const harness = createHarness(config);

  await harness.handlers.get("session_start")?.({}, harness.ctx);

  assert.equal(harness.servers.length, 0);
  assert.deepEqual(harness.opened, []);
});

test("starts the server and opens the browser once on session start", async () => {
  const harness = createHarness();

  await harness.handlers.get("session_start")?.({}, harness.ctx);

  assert.equal(harness.servers.length, 1);
  assert.equal(harness.servers[0].starts.length, 1);
  assert.equal(harness.servers[0].starts[0].cwd, "/tmp/project");
  assert.equal(harness.servers[0].starts[0].globalDatabasePath, "/home/me/.pi/pi-ext.db");
  assert.deepEqual(harness.opened, ["http://127.0.0.1:17380/"]);
});

test("updates on session tree without reopening the browser by default", async () => {
  const harness = createHarness();

  await harness.handlers.get("session_start")?.({}, harness.ctx);
  await harness.handlers.get("session_tree")?.({}, { ...harness.ctx, cwd: "/tmp/next" });

  assert.equal(harness.servers[0].starts.length, 1);
  assert.equal(harness.servers[0].updates.length, 1);
  assert.equal(harness.servers[0].updates[0].cwd, "/tmp/next");
  assert.deepEqual(harness.opened, ["http://127.0.0.1:17380/"]);
});

test("reopens on session tree when configured", async () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    modules: { dashboard: { browser: { reopenOnSessionChange: true } } },
  });
  const harness = createHarness(config);

  await harness.handlers.get("session_start")?.({}, harness.ctx);
  await harness.handlers.get("session_tree")?.({}, harness.ctx);

  assert.deepEqual(harness.opened, ["http://127.0.0.1:17380/", "http://127.0.0.1:17380/"]);
});

test("stops the server on session shutdown", async () => {
  const harness = createHarness();

  await harness.handlers.get("session_start")?.({}, harness.ctx);
  await harness.handlers.get("session_shutdown")?.({}, harness.ctx);

  assert.equal(harness.servers[0].stops, 1);
});

test("logs and continues when server startup fails", async () => {
  const harness = createHarness();
  const startError = new Error("port busy");
  const module = createDashboardModule({
    createServer() {
      const server = new FakeDashboardServer();
      server.startError = startError;
      harness.servers.push(server);
      return server as never;
    },
    openBrowser: async (url: string) => {
      harness.opened.push(url);
    },
  });
  harness.handlers.clear();
  module.register({
    pi: { on: (name: string, handler: Function) => harness.handlers.set(name, handler), registerCommand: () => {} } as never,
    getRuntime: () => ({
      config: defaultPiExtConfig,
      logger: { warn: (message: string, data?: unknown) => harness.warnings.push({ message, data }) } as never,
    }),
    getDatabases: async () => ({ global: { path: "/home/me/.pi/pi-ext.db" } }) as never,
    registerDatabaseMigrations: () => {},
    isEnabled: () => true,
    onRuntimeReload: () => {},
  });

  await assert.doesNotReject(() => harness.handlers.get("session_start")?.({}, harness.ctx));

  assert.equal(harness.servers.at(-1)?.starts.length, 1);
  assert.deepEqual(harness.opened, []);
  assert.equal(harness.warnings.length, 1);
});

test("logs and continues when browser opening fails", async () => {
  const harness = createHarness();
  harness.opened.splice(0);
  const openError = new Error("no browser");
  const module = createDashboardModule({
    createServer() {
      const server = new FakeDashboardServer();
      harness.servers.push(server);
      return server as never;
    },
    openBrowser: async () => {
      throw openError;
    },
  });
  harness.handlers.clear();
  module.register({
    pi: { on: (name: string, handler: Function) => harness.handlers.set(name, handler), registerCommand: () => {} } as never,
    getRuntime: () => ({
      config: defaultPiExtConfig,
      logger: { warn: (message: string, data?: unknown) => harness.warnings.push({ message, data }) } as never,
    }),
    getDatabases: async () => ({ global: { path: "/home/me/.pi/pi-ext.db" } }) as never,
    registerDatabaseMigrations: () => {},
    isEnabled: () => true,
    onRuntimeReload: () => {},
  });

  await harness.handlers.get("session_start")?.({}, harness.ctx);

  assert.equal(harness.servers.at(-1)?.starts.length, 1);
  assert.equal(harness.warnings.length, 1);
});
