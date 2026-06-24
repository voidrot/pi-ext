import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateToolResultIds } from "../../../src/modules/dcp/strategies/deduplication";

test("finds older duplicate tool calls", () => {
  const calls = [
    { id: "a", toolName: "read", args: { path: "x" }, protected: false },
    { id: "b", toolName: "read", args: { path: "x" }, protected: false },
    { id: "c", toolName: "read", args: { path: "y" }, protected: false },
  ];
  assert.deepEqual(findDuplicateToolResultIds(calls), ["a"]);
});
