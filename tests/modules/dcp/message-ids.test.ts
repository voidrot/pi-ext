import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBlockRef,
  formatMessageIdTag,
  formatMessageRef,
  parseBlockRef,
  parseBoundaryId,
  parseMessageRef,
} from "../../../src/modules/dcp/message-ids";

test("formats and parses message refs", () => {
  assert.equal(formatMessageRef(1), "m0001");
  assert.equal(formatMessageRef(42), "m0042");
  assert.equal(parseMessageRef("m0042"), 42);
  assert.equal(parseMessageRef("M0042"), 42);
  assert.equal(parseMessageRef("x0042"), null);
});

test("formats and parses block refs", () => {
  assert.equal(formatBlockRef(3), "b3");
  assert.equal(parseBlockRef("b3"), 3);
  assert.equal(parseBlockRef("B3"), 3);
  assert.equal(parseBlockRef("b0"), null);
});

test("parses boundary ids", () => {
  assert.deepEqual(parseBoundaryId("m0007"), {
    kind: "message",
    ref: "m0007",
    index: 7,
  });
  assert.deepEqual(parseBoundaryId("b12"), {
    kind: "compressed-block",
    ref: "b12",
    blockId: 12,
  });
  assert.equal(parseBoundaryId("nope"), null);
});

test("formats escaped message id tags", () => {
  assert.equal(
    formatMessageIdTag("m0001"),
    "\n<dcp-message-id>m0001</dcp-message-id>",
  );
  assert.equal(
    formatMessageIdTag("b1", { topic: "a & b" }),
    '\n<dcp-message-id topic="a &amp; b">b1</dcp-message-id>',
  );
});
