import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverAgentDefinitions, parseAgentDefinition } from "../../../src/modules/agents/definitions";

test("parses agent markdown frontmatter", () => {
  const parsed = parseAgentDefinition(
    "/tmp/scout.md",
    `---\nname: scout\ndescription: Recon\ntools: read, grep, find\nmodel: anthropic/claude-haiku-4-5\nthinking: off\nmax_turns: 3\nextensions: none\n---\nScout prompt\n`,
  );

  assert.equal(parsed?.name, "scout");
  assert.deepEqual(parsed?.tools, ["read", "grep", "find"]);
  assert.equal(parsed?.model, "anthropic/claude-haiku-4-5");
  assert.equal(parsed?.thinking, "off");
  assert.equal(parsed?.maxTurns, 3);
  assert.equal(parsed?.extensionMode, "none");
  assert.equal(parsed?.systemPrompt, "Scout prompt");
});

test("discovers agents from agentDir/agents", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-agents-"));
  const agentsDir = join(root, "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, "scout.md"), `---\nname: scout\ndescription: Recon\n---\nPrompt\n`);
  writeFileSync(join(agentsDir, "bad.md"), `---\nname: bad\n---\nPrompt\n`);

  const result = discoverAgentDefinitions(root);

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].name, "scout");
  assert.equal(result.agents[0].source, "user");
  assert.equal(result.diagnostics.length, 1);
});

test("tools none produces an empty tool list and omitted tools uses defaults", () => {
  const noTools = parseAgentDefinition("/tmp/none.md", `---\nname: none\ndescription: No tools\ntools: none\n---\nPrompt\n`);
  const defaults = parseAgentDefinition("/tmp/default.md", `---\nname: default\ndescription: Defaults\n---\nPrompt\n`);

  assert.deepEqual(noTools?.tools, []);
  assert.deepEqual(defaults?.tools, ["read", "bash", "edit", "write"]);
});
