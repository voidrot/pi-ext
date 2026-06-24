import assert from "node:assert/strict";
import test from "node:test";
import { shouldPurgeErroredToolInput } from "../../../src/modules/dcp/strategies/purge-errors";

test("purges errored tool input after threshold", () => {
  assert.equal(
    shouldPurgeErroredToolInput({ status: "error", turn: 1 }, 5, 4),
    true,
  );
  assert.equal(
    shouldPurgeErroredToolInput({ status: "error", turn: 3 }, 5, 4),
    false,
  );
  assert.equal(
    shouldPurgeErroredToolInput({ status: "completed", turn: 1 }, 5, 4),
    false,
  );
});
