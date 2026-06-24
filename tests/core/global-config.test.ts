import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureGlobalPiExtConfig } from "../../src/core/config";

test("creates a basic global jsonc config when no global config exists", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-ext-agent-"));

  const result = ensureGlobalPiExtConfig(agentDir);
  const configPath = join(agentDir, "pi-ext.jsonc");

  assert.equal(result.created, true);
  assert.equal(result.path, configPath);
  assert.equal(existsSync(configPath), true);
  assert.equal(
    readFileSync(configPath, "utf8"),
    '{\n  "$schema": "https://raw.githubusercontent.com/voidrot/pi-ext/main/schema/pi-ext.schema.json"\n}\n',
  );
});

test("does not create jsonc when global json config exists", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-ext-agent-"));
  const jsonPath = join(agentDir, "pi-ext.json");
  writeFileSync(jsonPath, "{}\n");

  const result = ensureGlobalPiExtConfig(agentDir);

  assert.equal(result.created, false);
  assert.equal(result.path, jsonPath);
  assert.equal(existsSync(join(agentDir, "pi-ext.jsonc")), false);
});

test("does not overwrite global jsonc config when it exists", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-ext-agent-"));
  const jsoncPath = join(agentDir, "pi-ext.jsonc");
  writeFileSync(jsoncPath, "// custom\n{}\n");

  const result = ensureGlobalPiExtConfig(agentDir);

  assert.equal(result.created, false);
  assert.equal(result.path, jsoncPath);
  assert.equal(readFileSync(jsoncPath, "utf8"), "// custom\n{}\n");
});
