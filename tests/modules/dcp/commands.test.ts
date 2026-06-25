import assert from "node:assert/strict";
import test from "node:test";
import { parseDcpCommand } from "../../../src/modules/dcp/commands";

test("parses dcp commands", () => {
  assert.deepEqual(parseDcpCommand(""), { action: "status", args: [] });
  assert.deepEqual(parseDcpCommand("manual on"), {
    action: "manual",
    args: ["on"],
  });
  assert.deepEqual(parseDcpCommand("decompress b2"), {
    action: "decompress",
    args: ["b2"],
  });
  assert.deepEqual(parseDcpCommand("stats"), {
    action: "stats",
    args: [],
  });
});
