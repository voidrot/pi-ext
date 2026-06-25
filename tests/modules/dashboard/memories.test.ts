import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDashboardMemoriesPayload,
  selectDashboardMemoryScope,
  type DashboardMemoryRecord,
} from "../../../src/modules/dashboard/memories";

function memory(overrides: Partial<DashboardMemoryRecord>): DashboardMemoryRecord {
  return {
    id: overrides.id ?? "memory-1",
    scope: overrides.scope ?? "global",
    content: overrides.content ?? "Remember this.",
    title: overrides.title,
    tags: overrides.tags ?? [],
    importance: overrides.importance ?? 3,
    createdAt: overrides.createdAt ?? "2026-06-24T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-24T12:00:00.000Z",
    sessionId: overrides.sessionId,
  };
}

test("creates combined memories payload with counts and ordered visible memories", () => {
  const payload = createDashboardMemoriesPayload({
    selectedScope: "combined",
    memories: {
      global: [memory({ id: "global-1", scope: "global", createdAt: "2026-06-24T10:00:00.000Z" })],
      project: [memory({ id: "project-1", scope: "project", createdAt: "2026-06-24T12:00:00.000Z" })],
      session: [memory({ id: "session-1", scope: "session", createdAt: "2026-06-24T11:00:00.000Z", sessionId: "s1" })],
    },
  });

  assert.equal(payload.selectedScope, "combined");
  assert.deepEqual(payload.counts, { combined: 3, global: 1, project: 1, session: 1 });
  assert.deepEqual(payload.visibleMemories.map((item) => item.id), ["project-1", "session-1", "global-1"]);
});

test("creates scoped memories payload and defaults invalid scopes to combined", () => {
  const memories = {
    global: [memory({ id: "global-1", scope: "global" })],
    project: [memory({ id: "project-1", scope: "project" })],
    session: [memory({ id: "session-1", scope: "session", sessionId: "s1" })],
  };

  const project = createDashboardMemoriesPayload({ selectedScope: "project", memories });

  assert.deepEqual(project.visibleMemories.map((item) => item.id), ["project-1"]);
  assert.equal(selectDashboardMemoryScope("not-a-scope"), "combined");
  assert.equal(selectDashboardMemoryScope("session"), "session");
});
