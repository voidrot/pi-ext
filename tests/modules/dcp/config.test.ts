import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, mergeDcpConfig } from "../../../src/modules/dcp/config";

test("returns defaults when no central overrides are provided", () => {
  const config = mergeDcpConfig({});

  assert.equal(config.enabled, true);
  assert.equal(config.compress.mode, "range");
  assert.equal(config.compress.nudgeFrequency, 5);
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

test("does not mutate default config", () => {
  const before = defaultConfig.compress.mode;
  const config = mergeDcpConfig({ compress: { mode: "message" } });

  assert.equal(config.compress.mode, "message");
  assert.equal(defaultConfig.compress.mode, before);
});
