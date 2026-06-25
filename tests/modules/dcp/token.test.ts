import assert from "node:assert/strict";
import test from "node:test";
import { estimateTokens } from "../../../src/modules/dcp/token";

test("counts tokens with tiktoken", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("hello world"), 2);
});
