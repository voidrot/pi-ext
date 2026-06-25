import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, mergeDcpConfig } from "../../../src/modules/dcp/config";

test("returns defaults when no central overrides are provided", () => {
  const config = mergeDcpConfig({});

  assert.equal(config.enabled, true);
  assert.equal(config.compress.mode, "range");
  assert.equal(config.compress.nudgeFrequency, 5);
  assert.equal(config.ui.compressedBlocksWidget, true);
  assert.equal(config.ui.compressionNotifications, true);
});

test("merges central pi-ext dcp config with protected tool dedupe", () => {
  const config = mergeDcpConfig({
    debug: true,
    compress: {
      mode: "message",
      protectedTools: ["read", "custom", "custom", "other"],
    },
  });

  assert.equal(config.debug, true);
  assert.equal(config.compress.mode, "message");
  assert.deepEqual(
    config.compress.protectedTools.filter((tool) => tool === "custom"),
    ["custom"],
  );
  assert.ok(config.compress.protectedTools.includes("read"));
  assert.ok(config.compress.protectedTools.includes("other"));
});

test("sanitizes numeric thresholds from central config", () => {
  const config = mergeDcpConfig({
    compress: { nudgeFrequency: 0, iterationNudgeThreshold: -5 },
    strategies: { purgeErrors: { turns: 0 } },
  });

  assert.equal(config.compress.nudgeFrequency, 1);
  assert.equal(config.compress.iterationNudgeThreshold, 1);
  assert.equal(config.strategies.purgeErrors.turns, 1);
});

test("merges DCP UI toggles from central config", () => {
  const config = mergeDcpConfig({
    ui: {
      compressedBlocksWidget: false,
      compressionNotifications: false,
    },
  });

  assert.equal(config.ui.compressedBlocksWidget, false);
  assert.equal(config.ui.compressionNotifications, false);
});

test("defaults stale tool stripping and summary tiers", () => {
  const config = mergeDcpConfig({});

  assert.equal(config.strategies.staleToolCalls.enabled, true);
  assert.equal(config.strategies.staleToolCalls.turns, 5);
  assert.deepEqual(config.compress.summaryTiers, [
    { minTurns: 0, maxSummaryRatio: 0.4 },
    { minTurns: 5, maxSummaryRatio: 0.25 },
    { minTurns: 15, maxSummaryRatio: 0.12 },
  ]);
});

test("merges stale tool and summary tier overrides safely", () => {
  const config = mergeDcpConfig({
    strategies: {
      staleToolCalls: { turns: 0, protectedTools: ["read", "custom", "custom"] },
    },
    compress: {
      summaryTiers: [
        { minTurns: 0, maxSummaryRatio: 0.5 },
        { minTurns: 20, maxSummaryRatio: 0.08 },
      ],
    },
  });

  assert.equal(config.strategies.staleToolCalls.turns, 1);
  assert.deepEqual(config.strategies.staleToolCalls.protectedTools, ["read", "custom"]);
  assert.deepEqual(config.compress.summaryTiers, [
    { minTurns: 0, maxSummaryRatio: 0.5 },
    { minTurns: 20, maxSummaryRatio: 0.08 },
  ]);
});

test("does not mutate default config", () => {
  const before = defaultConfig.compress.mode;
  const config = mergeDcpConfig({ compress: { mode: "message" } });

  assert.equal(config.compress.mode, "message");
  assert.equal(defaultConfig.compress.mode, before);
});
