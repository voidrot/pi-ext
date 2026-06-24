import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePiExtCommand } from "../../src/core/commands";

test("empty pi-ext command defaults to status", () => {
  assert.equal(parsePiExtCommand(""), "status");
});

test("parses status command", () => {
  assert.equal(parsePiExtCommand("status"), "status");
});

test("parses config command", () => {
  assert.equal(parsePiExtCommand("config"), "config");
});

test("parses reload command", () => {
  assert.equal(parsePiExtCommand("reload"), "reload");
});

test("unknown command returns help", () => {
  assert.equal(parsePiExtCommand("unknown stuff"), "help");
});
