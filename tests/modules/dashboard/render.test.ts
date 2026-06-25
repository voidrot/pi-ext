import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardStatus, renderDashboardHtml } from "../../../src/modules/dashboard/render";

test("creates status with global database and omits missing project database", () => {
  const status = createDashboardStatus({
    instanceId: "dash-1",
    startedAt: new Date("2026-06-24T12:00:00.000Z"),
    url: "http://127.0.0.1:17380/",
    host: "127.0.0.1",
    port: 17380,
    cwd: "/tmp/project",
    projectTrusted: false,
    sessionFile: undefined,
    debug: false,
    enabled: true,
    modules: { dcp: true, dashboard: true },
    globalDatabasePath: "/home/me/.pi/pi-ext.db",
    projectDatabasePath: undefined,
  });

  assert.equal(status.database.global.path, "/home/me/.pi/pi-ext.db");
  assert.equal(status.database.project, undefined);
  assert.equal(status.runtime.modules.dashboard, true);
});

test("renders escaped placeholder HTML with useful dashboard links", () => {
  const status = createDashboardStatus({
    instanceId: "<script>alert(1)</script>",
    startedAt: new Date("2026-06-24T12:00:00.000Z"),
    url: "http://127.0.0.1:17380/",
    host: "127.0.0.1",
    port: 17380,
    cwd: "/tmp/<project>&\"bad\"",
    projectTrusted: true,
    sessionFile: "/tmp/session.json",
    debug: true,
    enabled: true,
    modules: { dcp: true, dashboard: true },
    globalDatabasePath: "/home/me/.pi/pi-ext.db",
    projectDatabasePath: "/tmp/<project>/.pi/pi-ext.db",
  });

  const html = renderDashboardHtml(status);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Pi Ext Dashboard/);
  assert.match(html, /href="\/api\/status"/);
  assert.match(html, /href="\/healthz"/);
  assert.match(html, /@tailwindcss\/browser@4/);
  assert.match(html, /type="text\/tailwindcss"/);
  assert.match(html, /data-slot="card"/);
  assert.match(html, /bg-background/);
  assert.match(html, /\/tmp\/&lt;project&gt;&amp;&quot;bad&quot;/);
  assert.match(html, /\/tmp\/&lt;project&gt;\/.pi\/pi-ext.db/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
