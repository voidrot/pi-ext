import assert from "node:assert/strict";
import test from "node:test";
import { createFramesFromMessages } from "../../../src/modules/dcp/pi/branch";

test("creates stable frames from messages and branch entries", () => {
  const message = { role: "user", content: "hello", timestamp: 1 };
  const frames = createFramesFromMessages(
    [message],
    [{ type: "message", id: "e1", message }],
  );
  assert.equal(frames[0]?.ref, "m0001");
  assert.equal(frames[0]?.entryId, "e1");
});
