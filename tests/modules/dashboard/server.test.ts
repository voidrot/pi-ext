import { createServer } from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardMemoriesPayload } from "../../../src/modules/dashboard/memories";
import { createDashboardApp, DashboardServer, type DashboardServerSnapshot } from "../../../src/modules/dashboard/server";

function snapshot(overrides: Partial<DashboardServerSnapshot> = {}): DashboardServerSnapshot {
  return {
    cwd: "/tmp/project",
    projectTrusted: true,
    sessionFile: "/tmp/session.json",
    debug: false,
    enabled: true,
    modules: { dcp: true, dashboard: true },
    globalDatabasePath: "/home/me/.pi/pi-ext.db",
    projectDatabasePath: "/tmp/project/.pi/pi-ext.db",
    ...overrides,
  };
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function occupyPort(port: number) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

test("creates a Hono app that serves health, JSON, shadcn/Tailwind HTML, and 404", async () => {
  const app = createDashboardApp({
    getStatus: () => ({
      dashboard: {
        instanceId: "dash-1",
        startedAt: "2026-06-24T12:00:00.000Z",
        url: "http://127.0.0.1:17380/",
        host: "127.0.0.1",
        port: 17380,
      },
      session: {
        cwd: "/tmp/<project>",
        projectTrusted: true,
        sessionFile: "/tmp/session.json",
      },
      runtime: {
        debug: false,
        enabled: true,
        modules: { dcp: true, dashboard: true },
      },
      database: {
        global: { path: "/home/me/.pi/pi-ext.db" },
        project: { path: "/tmp/project/.pi/pi-ext.db" },
      },
    }),
  });

  const health = await app.request("/healthz");
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "ok");

  const status = await app.request("/api/status");
  assert.equal(status.headers.get("content-type"), "application/json; charset=utf-8");
  const json = (await status.json()) as any;
  assert.equal(json.session.cwd, "/tmp/<project>");

  const page = await app.request("/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /@tailwindcss\/browser@4/);
  assert.match(html, /type="text\/tailwindcss"/);
  assert.match(html, /data-slot="card"/);
  assert.match(html, /bg-background/);
  assert.doesNotMatch(html, /<project>/);
  assert.match(html, /&lt;project&gt;/);

  const missing = await app.request("/missing");
  assert.equal(missing.status, 404);
});

test("serves stored memories as JSON and HTML by scope", async () => {
  const app = createDashboardApp({
    getStatus: () => ({
      dashboard: {
        instanceId: "dash-1",
        startedAt: "2026-06-24T12:00:00.000Z",
        url: "http://127.0.0.1:17380/",
        host: "127.0.0.1",
        port: 17380,
      },
      session: { cwd: "/tmp/project", projectTrusted: true },
      runtime: { debug: false, enabled: true, modules: { dcp: true, dashboard: true } },
      database: { global: { path: "/home/me/.pi/pi-ext.db" } },
    }),
    getMemories: async (scope) => createDashboardMemoriesPayload({
      selectedScope: scope,
      memories: {
        global: [],
        project: [
          {
            id: "project-1",
            scope: "project",
            content: "Project memory",
            tags: ["project"],
            importance: 5,
            createdAt: "2026-06-24T12:00:00.000Z",
            updatedAt: "2026-06-24T12:00:00.000Z",
          },
        ],
        session: [],
      },
    }),
  });

  const jsonResponse = await app.request("/api/memories/project");
  assert.equal(jsonResponse.status, 200);
  assert.equal(jsonResponse.headers.get("content-type"), "application/json; charset=utf-8");
  const json = (await jsonResponse.json()) as any;
  assert.equal(json.selectedScope, "project");
  assert.equal(json.visibleMemories[0].id, "project-1");

  const page = await app.request("/memories/project");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Stored memories/);
  assert.match(html, /Project memory/);
});

test("returns a startup guard when status is requested before server state is ready", async () => {
  const app = createDashboardApp({
    getStatus: () => {
      throw new Error("Dashboard server status requested before startup");
    },
  });

  const status = await app.request("/api/status");
  assert.equal(status.status, 503);
  assert.equal(status.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await status.json(), { status: "starting" });

  const page = await app.request("/");
  assert.equal(page.status, 503);
  assert.match(await page.text(), /Dashboard starting/);
});

test("starts on an auto-selected port and serves health, JSON, HTML, and 404", async () => {
  const port = await getFreePort();
  const server = new DashboardServer({ host: "127.0.0.1", port: "auto", portRange: { start: port, end: port } });

  try {
    const state = await server.start(snapshot());

    assert.equal(state.host, "127.0.0.1");
    assert.equal(state.port, port);
    assert.equal(state.url, `http://127.0.0.1:${port}/`);

    const health = await fetch(`${state.url}healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const status = await fetch(`${state.url}api/status`);
    assert.equal(status.headers.get("content-type"), "application/json; charset=utf-8");
    const json = (await status.json()) as any;
    assert.equal(json.session.cwd, "/tmp/project");
    assert.equal(json.database.global.path, "/home/me/.pi/pi-ext.db");

    const html = await fetch(state.url);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /\/tmp\/project/);

    const missing = await fetch(`${state.url}missing`);
    assert.equal(missing.status, 404);
  } finally {
    await server.stop();
  }
});

test("start reuses the existing server and updates its snapshot", async () => {
  const port = await getFreePort();
  const server = new DashboardServer({ host: "127.0.0.1", port: port, portRange: { start: port, end: port } });

  try {
    const first = await server.start(snapshot({ cwd: "/tmp/one" }));
    const second = await server.start(snapshot({ cwd: "/tmp/two" }));

    assert.deepEqual(second, first);
    const status = await fetch(`${first.url}api/status`);
    const json = (await status.json()) as any;
    assert.equal(json.session.cwd, "/tmp/two");
  } finally {
    await server.stop();
  }
});

test("configured occupied port fails cleanly", async () => {
  const port = await getFreePort();
  const occupied = await occupyPort(port);
  const server = new DashboardServer({ host: "127.0.0.1", port: port, portRange: { start: port, end: port } });

  try {
    await assert.rejects(() => server.start(snapshot()), /Unable to start dashboard server/);
  } finally {
    await new Promise<void>((resolve, reject) => occupied.close((error) => (error ? reject(error) : resolve())));
    await server.stop();
  }
});

test("auto mode skips occupied ports inside the configured range", async () => {
  const firstPort = await getFreePort();
  const secondPort = await getFreePort();
  const start = Math.min(firstPort, secondPort);
  const end = Math.max(firstPort, secondPort);
  const occupied = await occupyPort(start);
  const server = new DashboardServer({ host: "127.0.0.1", port: "auto", portRange: { start, end } });

  try {
    const state = await server.start(snapshot());
    assert.notEqual(state.port, start);
    assert.ok(state.port >= start && state.port <= end);
  } finally {
    await new Promise<void>((resolve, reject) => occupied.close((error) => (error ? reject(error) : resolve())));
    await server.stop();
  }
});

test("stop closes the server port", async () => {
  const port = await getFreePort();
  const server = new DashboardServer({ host: "127.0.0.1", port, portRange: { start: port, end: port } });
  const state = await server.start(snapshot());

  await server.stop();

  await assert.rejects(() => fetch(state.url), /fetch failed/);
});
