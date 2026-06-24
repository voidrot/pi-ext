import assert from "node:assert/strict";
import test from "node:test";
import { estimateTokens } from "../../../src/modules/dcp/token";

test("estimates tokens deterministically", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});
