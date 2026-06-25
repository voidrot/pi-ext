import assert from "node:assert/strict";
import test from "node:test";
import { formatMemoryPrompt } from "../../../src/modules/memory/prompt";
import type { PromptMemoryList } from "../../../src/modules/memory/repository";

const memories: PromptMemoryList = {
  global: [{ id: "g1", scope: "global", content: "Use concise answers.", title: "Style", tags: ["style"], importance: 4, createdAt: "now", updatedAt: "now" }],
  project: [{ id: "p1", scope: "project", content: "This repo uses npm scripts.", tags: [], importance: 3, createdAt: "now", updatedAt: "now" }],
  session: [{ id: "s1", scope: "session", content: "In this session, only plan changes.", tags: ["session"], importance: 5, createdAt: "now", updatedAt: "now", sessionId: "session-1" }],
};

test("formats scoped memories for system prompt", () => {
  const prompt = formatMemoryPrompt(memories, { maxContentChars: 80 });

  assert.match(prompt, /Relevant saved memories/);
  assert.match(prompt, /Global memories/);
  assert.match(prompt, /Project memories/);
  assert.match(prompt, /Session memories/);
  assert.match(prompt, /Use concise answers/);
  assert.match(prompt, /This repo uses npm scripts/);
  assert.match(prompt, /only plan changes/);
});

test("returns empty string when no memories exist", () => {
  const prompt = formatMemoryPrompt({ global: [], project: [], session: [] }, { maxContentChars: 80 });

  assert.equal(prompt, "");
});

test("truncates long memory content", () => {
  const prompt = formatMemoryPrompt({ global: [{ ...memories.global[0], content: "a".repeat(100) }], project: [], session: [] }, { maxContentChars: 12 });

  assert.match(prompt, /aaaaaaaaaaaa…/);
});
