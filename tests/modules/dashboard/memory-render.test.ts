import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardMemoriesPayload } from "../../../src/modules/dashboard/memories";
import { renderDashboardMemoriesHtml } from "../../../src/modules/dashboard/memory-render";

test("renders escaped stored memories page with scope navigation", () => {
  const payload = createDashboardMemoriesPayload({
    selectedScope: "combined",
    memories: {
      global: [
        {
          id: "memory-1",
          scope: "global",
          title: "Unsafe <title>",
          content: "Remember <script>alert(1)</script> & keep it safe.",
          tags: ["tooling", "<bad>"],
          importance: 4,
          createdAt: "2026-06-24T12:00:00.000Z",
          updatedAt: "2026-06-24T12:00:00.000Z",
        },
      ],
      project: [],
      session: [],
    },
  });

  const html = renderDashboardMemoriesHtml(payload);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Stored memories/);
  assert.match(html, /href="\/memories\/global"/);
  assert.match(html, /href="\/memories\/project"/);
  assert.match(html, /href="\/memories\/session"/);
  assert.match(html, /href="\/api\/memories"/);
  assert.match(html, /Unsafe &lt;title&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
