import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultPiExtConfig,
  getPiExtConfigPaths,
  loadPiExtConfig,
  mergePiExtConfig,
} from "../../src/core/config";

test("loads defaults when no config exists", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-config-"));
  const config = loadPiExtConfig({ cwd: root, agentDir: join(root, "agent"), projectTrusted: false });

  assert.equal(config.enabled, true);
  assert.equal(config.modules.dcp.enabled, true);
  assert.equal(config.modules.dcp.tools.compress.enabled, true);
  assert.equal(config.modules.dashboard.enabled, true);
  assert.equal(config.modules.dashboard.server.host, "127.0.0.1");
  assert.equal(config.modules.dashboard.server.port, "auto");
  assert.equal(config.modules.dashboard.browser.openOnStart, true);
  assert.equal(config.modules.agents.enabled, true);
  assert.equal(config.modules.agents.orchestrator.enabled, true);
  assert.equal(config.modules.agents.tools.runSubagent.enabled, true);
  assert.equal(config.modules.agents.tools.getSubagentResult.enabled, true);
  assert.equal(config.modules.agents.tools.steerSubagent.enabled, true);
  assert.equal(config.modules.agents.maxParallel, 4);
  assert.equal(config.modules.agents.childExtensions.mode, "inherit-safe");
  assert.equal(config.modules.agents.transcripts.persist, true);
  assert.equal(config.modules.agents.stall.enabled, true);
});

test("merges global jsonc over defaults", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-config-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "pi-ext.jsonc"),
    `{
      // enable debugging and disable one owned tool
      "debug": true,
      "modules": { "dcp": { "tools": { "compress": { "enabled": false } } } }
    }`,
  );

  const config = loadPiExtConfig({ cwd: root, agentDir, projectTrusted: false });

  assert.equal(config.debug, true);
  assert.equal(config.modules.dcp.enabled, true);
  assert.equal(config.modules.dcp.tools.compress.enabled, false);
});

test("ignores project config when project is not trusted", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-config-"));
  await mkdir(join(root, ".pi"), { recursive: true });
  await writeFile(join(root, ".pi", "pi-ext.json"), JSON.stringify({ modules: { dcp: { enabled: false } } }));

  const config = loadPiExtConfig({ cwd: root, agentDir: join(root, "agent"), projectTrusted: false });

  assert.equal(config.modules.dcp.enabled, true);
});

test("applies trusted project override after global config", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-config-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(root, ".pi"), { recursive: true });
  await writeFile(join(agentDir, "pi-ext.json"), JSON.stringify({ debug: true, modules: { dcp: { enabled: true } } }));
  await writeFile(join(root, ".pi", "pi-ext.jsonc"), `{ "modules": { "dcp": { "enabled": false } } }`);

  const config = loadPiExtConfig({ cwd: root, agentDir, projectTrusted: true });

  assert.equal(config.debug, true);
  assert.equal(config.modules.dcp.enabled, false);
});

test("project jsonc has highest precedence", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-config-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(root, ".pi"), { recursive: true });
  await writeFile(join(agentDir, "pi-ext.jsonc"), `{ "debug": true }`);
  await writeFile(join(root, ".pi", "pi-ext.json"), `{ "debug": false }`);
  await writeFile(join(root, ".pi", "pi-ext.jsonc"), `{ "debug": true }`);

  const config = loadPiExtConfig({ cwd: root, agentDir, projectTrusted: true });

  assert.equal(config.debug, true);
});

test("merges module config without losing defaults", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    modules: {
      dcp: {
        config: {
          compress: { permission: "deny" },
        },
      },
    },
  });

  assert.equal(config.modules.dcp.enabled, true);
  assert.equal(config.modules.dcp.tools.compress.enabled, true);
  assert.deepEqual(config.modules.dcp.config, { compress: { permission: "deny" } });
});

test("merges partial dashboard browser config without losing server defaults", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    modules: {
      dashboard: {
        browser: { openOnStart: false },
      },
    },
  });

  assert.equal(config.modules.dashboard.enabled, true);
  assert.equal(config.modules.dashboard.browser.openOnStart, false);
  assert.equal(config.modules.dashboard.browser.reopenOnSessionChange, false);
  assert.equal(config.modules.dashboard.server.host, "127.0.0.1");
  assert.equal(config.modules.dashboard.server.port, "auto");
  assert.deepEqual(config.modules.dashboard.server.portRange, { start: 17380, end: 17480 });
});

test("merges partial dashboard server config without losing browser defaults", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    modules: {
      dashboard: {
        server: { port: 17381 },
      },
    },
  });

  assert.equal(config.modules.dashboard.enabled, true);
  assert.equal(config.modules.dashboard.server.port, 17381);
  assert.equal(config.modules.dashboard.server.host, "127.0.0.1");
  assert.equal(config.modules.dashboard.browser.openOnStart, true);
  assert.equal(config.modules.dashboard.browser.reopenOnSessionChange, false);
});

test("accepts top-level dcp config shorthand for global DCP settings", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    dcp: {
      ui: { compressedBlocksWidget: false },
      compress: { permission: "deny" },
    },
  });

  assert.deepEqual(config.modules.dcp.config, {
    ui: { compressedBlocksWidget: false },
    compress: { permission: "deny" },
  });
});

test("explicit module DCP config overrides top-level dcp shorthand", () => {
  const config = mergePiExtConfig(defaultPiExtConfig, {
    dcp: { ui: { compressedBlocksWidget: false, compressionNotifications: false } },
    modules: {
      dcp: {
        config: {
          ui: { compressedBlocksWidget: true },
        },
      },
    },
  });

  assert.deepEqual(config.modules.dcp.config, {
    ui: { compressedBlocksWidget: true, compressionNotifications: false },
  });
});

test("later top-level dcp shorthand overrides earlier top-level dcp shorthand", () => {
  const first = mergePiExtConfig(defaultPiExtConfig, {
    dcp: { ui: { compressedBlocksWidget: false, compressionNotifications: true } },
  });
  const second = mergePiExtConfig(first, {
    dcp: { ui: { compressedBlocksWidget: true } },
  });

  assert.deepEqual(second.modules.dcp.config, {
    ui: { compressedBlocksWidget: true, compressionNotifications: true },
  });
});

test("reports config paths in load order", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-config-"));
  const paths = getPiExtConfigPaths({ cwd: root, agentDir: join(root, "agent"), projectTrusted: true });

  assert.equal(paths[0], join(root, "agent", "pi-ext.json"));
  assert.equal(paths[1], join(root, "agent", "pi-ext.jsonc"));
  assert.equal(paths[2], join(root, ".pi", "pi-ext.json"));
  assert.equal(paths[3], join(root, ".pi", "pi-ext.jsonc"));
  assert.equal(existsSync(paths[0]), false);
});
