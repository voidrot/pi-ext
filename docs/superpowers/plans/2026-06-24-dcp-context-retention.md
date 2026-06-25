# DCP Context Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update DCP so old tool-call artifacts are stripped after 5 turns by default, stale/unhelpful compressed chunks stop consuming context, and compression summaries get stricter age-based token budgets.

**Architecture:** Keep DCP as a non-destructive context transformer: session files remain intact, while outgoing model context is rewritten. Add persisted metadata for tool/message ages, then apply retention before context output: stale tool call/result pairs are removed, orphaned or net-negative compression blocks are deactivated, and compression requests are validated against age-tier summary budgets.

**Tech Stack:** TypeScript, Pi extension lifecycle hooks, `node:test`, existing DCP state custom entries.

---

## Current code map

- `src/modules/dcp/index.ts` wires Pi events, context transformation, commands, and `compress` tool registration.
- `src/modules/dcp/context/transform.ts` injects active compression summaries and removes compressed raw messages.
- `src/modules/dcp/compress/state.ts` applies `compress` tool calls and creates `CompressionBlock`s.
- `src/modules/dcp/state/types.ts` and `src/modules/dcp/state/store.ts` serialize DCP state into custom session entries.
- `src/modules/dcp/pi/branch.ts` maps context messages to branch entry IDs and refs.
- `src/modules/dcp/config.ts` owns default/merged DCP config.
- `tests/modules/dcp/*.test.ts` cover config, compression, transform, state, UI, and strategy helpers.

## Design decisions

1. **Tool-call stripping is context-only.** Do not edit the session JSONL. Remove stale assistant `toolCall` blocks and their matching `toolResult` messages from outgoing `context` event messages.
2. **Default threshold is 5 DCP turns.** Add `strategies.staleToolCalls.turns = 5`; protected tools opt out.
3. **Never leave dangling pairs.** If a stale tool result is dropped, the matching assistant `toolCall` content block must also be dropped.
4. **Compressed blocks that only summarize stale tool artifacts are not helpful.** Deactivate those blocks so stale-tool stripping handles the raw entries instead of injecting a summary.
5. **Drop/deactivate only safe unhelpful blocks.** Deactivate active blocks when they are orphaned from the current branch, net-negative/zero-savings, or superseded by stale-tool stripping. Do not deactivate large useful summaries merely because they miss a stricter old-age ratio; instead reject future over-budget summaries.
6. **Age-tier ratios are enforced at compression time.** The `compress` tool validates summary token count against the selected tier. The selected tier is based on the youngest selected frame age, so mixed recent+old ranges use the less aggressive budget.

---

## File structure changes

- Modify: `src/modules/dcp/config.ts`
  - Add `strategies.staleToolCalls` and `compress.summaryTiers` defaults/merge validation.
- Modify: `src/modules/dcp/state/types.ts`
  - Add persisted `toolCalls` and `messageTurns` maps/arrays, plus block `createdTurn`.
- Modify: `src/modules/dcp/state/store.ts`
  - Serialize/deserialize new maps with backward-compatible defaults.
- Create: `src/modules/dcp/retention/age.ts`
  - Helpers for message turn assignment and compression tier selection.
- Create: `src/modules/dcp/retention/stale-tools.ts`
  - Helpers to identify stale tool call IDs and strip matching context artifacts safely.
- Create: `src/modules/dcp/retention/compressed-blocks.ts`
  - Helpers to deactivate orphaned, net-negative, and stale-tool-only compression blocks.
- Modify: `src/modules/dcp/context/transform.ts`
  - Apply age metadata, retention, stale-tool stripping, and compression summary injection in a deterministic order.
- Modify: `src/modules/dcp/compress/state.ts`
  - Accept config, stamp `createdTurn`, and enforce age-tier summary budgets.
- Modify: `src/modules/dcp/tools/compress.ts`
  - Pass config into compression apply functions and improve tool prompt snippets.
- Modify: `src/modules/dcp/index.ts`
  - Record tool call lifecycle metadata and append DCP state at turn end.
- Modify: `src/modules/dcp/prompts.ts`
  - Tell the model not to compress old tool artifacts and to follow age-tier budgets.
- Modify: `README.md`, `config/pi-ext.example.jsonc`, `schema/pi-ext.schema.json`
  - Document new config keys.
- Add/modify tests under `tests/modules/dcp/`.

---

## Task 1: Add config and state shape

**Files:**
- Modify: `src/modules/dcp/config.ts`
- Modify: `src/modules/dcp/state/types.ts`
- Modify: `src/modules/dcp/state/store.ts`
- Modify: `tests/modules/dcp/config.test.ts`
- Modify: `tests/modules/dcp/state-store.test.ts`

- [x] **Step 1: Write failing config tests**

Add to `tests/modules/dcp/config.test.ts`:

```ts
test("defaults stale tool stripping and summary tiers", () => {
  const config = mergeDcpConfig({});
  assert.equal(config.strategies.staleToolCalls.enabled, true);
  assert.equal(config.strategies.staleToolCalls.turns, 5);
  assert.deepEqual(config.compress.summaryTiers, [
    { minTurns: 0, maxSummaryRatio: 0.4 },
    { minTurns: 5, maxSummaryRatio: 0.25 },
    { minTurns: 15, maxSummaryRatio: 0.12 },
  ]);
});

test("merges stale tool and summary tier overrides safely", () => {
  const config = mergeDcpConfig({
    strategies: {
      staleToolCalls: { turns: 0, protectedTools: ["read", "custom", "custom"] },
    },
    compress: {
      summaryTiers: [
        { minTurns: 0, maxSummaryRatio: 0.5 },
        { minTurns: 20, maxSummaryRatio: 0.08 },
      ],
    },
  });

  assert.equal(config.strategies.staleToolCalls.turns, 1);
  assert.deepEqual(config.strategies.staleToolCalls.protectedTools, ["read", "custom"]);
  assert.deepEqual(config.compress.summaryTiers, [
    { minTurns: 0, maxSummaryRatio: 0.5 },
    { minTurns: 20, maxSummaryRatio: 0.08 },
  ]);
});
```

- [x] **Step 2: Write failing state serialization test**

Add to `tests/modules/dcp/state-store.test.ts`:

```ts
test("serializes new DCP retention metadata", () => {
  const state = createInitialState();
  state.toolCalls.set("call_1", {
    id: "call_1",
    toolName: "bash",
    turn: 2,
    status: "completed",
  });
  state.messageTurns.set("e1", 2);

  const restored = deserializeState(serializeState(state));

  assert.deepEqual(restored.toolCalls.get("call_1"), {
    id: "call_1",
    toolName: "bash",
    turn: 2,
    status: "completed",
  });
  assert.equal(restored.messageTurns.get("e1"), 2);
});
```

- [x] **Step 3: Implement state/config types**

In `src/modules/dcp/state/types.ts`, add:

```ts
export interface ToolCallRecord {
  id: string;
  toolName: string;
  turn: number;
  status: "pending" | "running" | "completed" | "error";
}
```

Extend `CompressionBlock`:

```ts
  createdTurn?: number;
```

Extend `DcpState`:

```ts
  toolCalls: Map<string, ToolCallRecord>;
  messageTurns: Map<string, number>;
```

Extend `SerializedDcpState`:

```ts
  toolCalls?: Array<[string, ToolCallRecord]>;
  messageTurns?: Array<[string, number]>;
```

In `src/modules/dcp/config.ts`, add types:

```ts
export interface CompressionSummaryTier {
  minTurns: number;
  maxSummaryRatio: number;
}
```

Extend `DcpConfig.compress`:

```ts
    summaryTiers: CompressionSummaryTier[];
```

Extend `DcpConfig.strategies`:

```ts
    staleToolCalls: { enabled: boolean; turns: number; protectedTools: string[] };
```

Add defaults:

```ts
    summaryTiers: [
      { minTurns: 0, maxSummaryRatio: 0.4 },
      { minTurns: 5, maxSummaryRatio: 0.25 },
      { minTurns: 15, maxSummaryRatio: 0.12 },
    ],
```

```ts
    staleToolCalls: { enabled: true, turns: 5, protectedTools: [] },
```

Add merge helpers for tiers:

```ts
function normalizeSummaryTiers(input: unknown, fallback: CompressionSummaryTier[]): CompressionSummaryTier[] {
  if (!Array.isArray(input)) return fallback;
  const tiers = input
    .map((item) => {
      const raw = item as Partial<CompressionSummaryTier>;
      if (typeof raw.minTurns !== "number" || typeof raw.maxSummaryRatio !== "number") return undefined;
      return {
        minTurns: Math.max(0, Math.floor(raw.minTurns)),
        maxSummaryRatio: Math.min(1, Math.max(0.01, raw.maxSummaryRatio)),
      };
    })
    .filter((item): item is CompressionSummaryTier => !!item)
    .sort((a, b) => a.minTurns - b.minTurns);
  return tiers.length > 0 && tiers[0]!.minTurns === 0 ? tiers : fallback;
}
```

- [x] **Step 4: Implement serialization defaults**

In `createInitialState()` add empty maps. In `serializeState()` serialize arrays. In `deserializeState()`, restore only valid entries and leave old sessions working when arrays are absent.

- [x] **Step 5: Run tests**

Run:

```bash
npm test -- tests/modules/dcp/config.test.ts tests/modules/dcp/state-store.test.ts
```

Expected: PASS.

---

## Task 2: Track turns, messages, and tool calls

**Files:**
- Create: `src/modules/dcp/retention/age.ts`
- Modify: `src/modules/dcp/index.ts`
- Add: `tests/modules/dcp/age.test.ts`

- [x] **Step 1: Write failing age helper tests**

Create `tests/modules/dcp/age.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/modules/dcp/state/store";
import { assignFrameTurns, getFrameAgeTurns, selectSummaryTier } from "../../../src/modules/dcp/retention/age";
import { defaultConfig } from "../../../src/modules/dcp/config";

test("assigns first-seen turns to frames without overwriting existing ages", () => {
  const state = createInitialState();
  state.messageTurns.set("old", 1);
  const frames = [
    { ref: "m0001", entryId: "old", message: { role: "user", content: "old" }, tokenCount: 1, toolCallIds: [], role: "user" },
    { ref: "m0002", entryId: "new", message: { role: "user", content: "new" }, tokenCount: 1, toolCallIds: [], role: "user" },
  ];

  assignFrameTurns(state, frames, 7);

  assert.equal(state.messageTurns.get("old"), 1);
  assert.equal(state.messageTurns.get("new"), 7);
  assert.equal(getFrameAgeTurns(state, frames[0]!, 7), 6);
  assert.equal(getFrameAgeTurns(state, frames[1]!, 7), 0);
});

test("selects stricter summary tiers as selected content ages", () => {
  assert.deepEqual(selectSummaryTier(defaultConfig.compress.summaryTiers, 0), { minTurns: 0, maxSummaryRatio: 0.4 });
  assert.deepEqual(selectSummaryTier(defaultConfig.compress.summaryTiers, 5), { minTurns: 5, maxSummaryRatio: 0.25 });
  assert.deepEqual(selectSummaryTier(defaultConfig.compress.summaryTiers, 20), { minTurns: 15, maxSummaryRatio: 0.12 });
});
```

- [x] **Step 2: Implement `age.ts`**

Create `src/modules/dcp/retention/age.ts`:

```ts
import type { CompressionSummaryTier } from "../config";
import type { ContextFrame, DcpState } from "../state/types";

export function assignFrameTurns(state: DcpState, frames: ContextFrame[], currentTurn: number): void {
  for (const frame of frames) {
    if (!state.messageTurns.has(frame.entryId)) {
      state.messageTurns.set(frame.entryId, currentTurn);
    }
  }
}

export function getFrameAgeTurns(state: DcpState, frame: ContextFrame, currentTurn: number): number {
  const turn = state.messageTurns.get(frame.entryId) ?? currentTurn;
  return Math.max(0, currentTurn - turn);
}

export function getYoungestFrameAgeTurns(state: DcpState, frames: ContextFrame[], currentTurn: number): number {
  if (frames.length === 0) return 0;
  return Math.min(...frames.map((frame) => getFrameAgeTurns(state, frame, currentTurn)));
}

export function selectSummaryTier(tiers: CompressionSummaryTier[], ageTurns: number): CompressionSummaryTier {
  let selected = tiers[0]!;
  for (const tier of tiers) {
    if (ageTurns >= tier.minTurns) selected = tier;
  }
  return selected;
}
```

- [x] **Step 3: Record tool lifecycle in `index.ts`**

In `registerDcp()`, add handlers:

```ts
  pi.on("tool_execution_start", async (event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled) return;
    current.state.toolCalls.set(event.toolCallId, {
      id: event.toolCallId,
      toolName: event.toolName,
      turn: current.state.turnCounter,
      status: "running",
    });
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled) return;
    const existing = current.state.toolCalls.get(event.toolCallId);
    current.state.toolCalls.set(event.toolCallId, {
      id: event.toolCallId,
      toolName: event.toolName,
      turn: existing?.turn ?? current.state.turnCounter,
      status: event.isError ? "error" : "completed",
    });
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled) return;
    current.state.turnCounter += 1;
    appendStateEntry(pi, current.state);
    refreshWidget(ctx, current);
  });
```

Import `appendStateEntry` from `./state/store`.

- [x] **Step 4: Run tests and typecheck**

Run:

```bash
npm test -- tests/modules/dcp/age.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 3: Strip stale tool-call artifacts from outgoing context

**Files:**
- Create: `src/modules/dcp/retention/stale-tools.ts`
- Modify: `src/modules/dcp/context/transform.ts`
- Add: `tests/modules/dcp/stale-tools.test.ts`
- Modify: `tests/modules/dcp/context-transform.test.ts`

- [x] **Step 1: Write failing stale tool tests**

Create `tests/modules/dcp/stale-tools.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/modules/dcp/state/store";
import { defaultConfig } from "../../../src/modules/dcp/config";
import { getStaleToolCallIds, stripStaleToolArtifacts } from "../../../src/modules/dcp/retention/stale-tools";

test("finds stale unprotected tool calls after threshold", () => {
  const state = createInitialState();
  state.toolCalls.set("old", { id: "old", toolName: "bash", turn: 1, status: "completed" });
  state.toolCalls.set("new", { id: "new", toolName: "bash", turn: 6, status: "completed" });

  const stale = getStaleToolCallIds(state, 6, defaultConfig);

  assert.deepEqual([...stale], ["old"]);
});

test("removes stale assistant toolCall blocks and stale toolResult messages", () => {
  const assistant = {
    role: "assistant",
    content: [
      { type: "text", text: "I checked this." },
      { type: "toolCall", id: "old", name: "bash", arguments: { command: "ls" } },
      { type: "toolCall", id: "keep", name: "read", arguments: { path: "README.md" } },
    ],
  };
  const toolResult = {
    role: "toolResult",
    toolCallId: "old",
    toolName: "bash",
    content: [{ type: "text", text: "output" }],
    isError: false,
  };

  const strippedAssistant = stripStaleToolArtifacts(assistant, new Set(["old"]));
  const strippedResult = stripStaleToolArtifacts(toolResult, new Set(["old"]));

  assert.deepEqual(strippedAssistant?.content, [
    { type: "text", text: "I checked this." },
    { type: "toolCall", id: "keep", name: "read", arguments: { path: "README.md" } },
  ]);
  assert.equal(strippedResult, undefined);
});
```

- [x] **Step 2: Implement stale tool helpers**

Create `src/modules/dcp/retention/stale-tools.ts`:

```ts
import { cloneMessage } from "../pi/messages";
import type { DcpConfig } from "../config";
import type { DcpState } from "../state/types";

export function getStaleToolCallIds(state: DcpState, currentTurn: number, config: DcpConfig): Set<string> {
  const stale = new Set<string>();
  if (!config.strategies.staleToolCalls.enabled) return stale;
  const protectedTools = new Set(config.strategies.staleToolCalls.protectedTools);
  const threshold = Math.max(1, config.strategies.staleToolCalls.turns);

  for (const record of state.toolCalls.values()) {
    if (protectedTools.has(record.toolName)) continue;
    if (currentTurn - record.turn >= threshold) stale.add(record.id);
  }
  return stale;
}

export function stripStaleToolArtifacts<T>(message: T, staleToolCallIds: Set<string>): T | undefined {
  const next: any = cloneMessage(message);

  if (next?.role === "toolResult" && staleToolCallIds.has(String(next.toolCallId))) {
    return undefined;
  }

  if (next?.role === "assistant" && Array.isArray(next.content)) {
    next.content = next.content.filter((part: any) => {
      return !(part?.type === "toolCall" && staleToolCallIds.has(String(part.id)));
    });
    if (next.content.length === 0) return undefined;
  }

  return next as T;
}
```

- [x] **Step 3: Apply stripping in context transform**

In `transformMessagesForContext()`:

1. Call `assignFrameTurns(input.state, input.frames, input.state.turnCounter)` at the start.
2. Compute `const staleToolCallIds = getStaleToolCallIds(input.state, input.state.turnCounter, config);`.
3. Before `sanitizeMessage()`, call `stripStaleToolArtifacts(frame.message, staleToolCallIds)`.
4. Skip the frame when it returns `undefined`.

The transformed frame block should look like:

```ts
    if (compressedEntryIds.has(frame.entryId)) continue;
    const stripped = stripStaleToolArtifacts(frame.message, staleToolCallIds);
    if (!stripped) continue;
    const message = sanitizeMessage(stripped);
    appendTextToMessage(message, formatMessageIdTag(frame.ref));
    transformed.push(message);
```

- [x] **Step 4: Add context integration test**

Add to `tests/modules/dcp/context-transform.test.ts`:

```ts
test("strips stale tool calls and matching results after configured turns", () => {
  const state = createInitialState();
  state.turnCounter = 6;
  state.toolCalls.set("call_old", { id: "call_old", toolName: "bash", turn: 1, status: "completed" });

  const messages = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "checking" },
        { type: "toolCall", id: "call_old", name: "bash", arguments: { command: "ls" } },
      ],
      timestamp: 1,
    },
    {
      role: "toolResult",
      toolCallId: "call_old",
      toolName: "bash",
      content: [{ type: "text", text: "lots of output" }],
      isError: false,
      timestamp: 2,
    },
  ];
  const frames = messages.map((message, index) => ({
    ref: `m000${index + 1}`,
    entryId: `e${index + 1}`,
    message,
    tokenCount: 10,
    toolCallIds: ["call_old"],
    role: message.role,
  }));

  const result = transformMessagesForContext({ messages, frames, state, usageTokens: null });

  assert.equal(result.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(result.messages), /toolCall/);
  assert.doesNotMatch(JSON.stringify(result.messages), /lots of output/);
  assert.match(JSON.stringify(result.messages), /checking/);
});
```

- [x] **Step 5: Run tests**

Run:

```bash
npm test -- tests/modules/dcp/stale-tools.test.ts tests/modules/dcp/context-transform.test.ts
```

Expected: PASS.

---

## Task 4: Drop/deactivate compressed chunks that are no longer helpful

**Files:**
- Create: `src/modules/dcp/retention/compressed-blocks.ts`
- Modify: `src/modules/dcp/context/transform.ts`
- Add: `tests/modules/dcp/compressed-block-retention.test.ts`

- [x] **Step 1: Write failing retention tests**

Create `tests/modules/dcp/compressed-block-retention.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/modules/dcp/state/store";
import { defaultConfig } from "../../../src/modules/dcp/config";
import { applyCompressedBlockRetention } from "../../../src/modules/dcp/retention/compressed-blocks";

test("deactivates active blocks whose entries are no longer on the current branch", () => {
  const state = createInitialState();
  state.blocks.set(1, {
    blockId: 1,
    runId: 1,
    active: true,
    topic: "orphan",
    mode: "range",
    startRef: "m0001",
    endRef: "m0002",
    anchorEntryId: "missing",
    originEntryId: "origin",
    directEntryIds: ["missing"],
    effectiveEntryIds: ["missing"],
    directToolCallIds: [],
    effectiveToolCallIds: [],
    consumedBlockIds: [],
    compressedTokens: 100,
    summaryTokens: 20,
    createdAt: 1,
    createdTurn: 1,
    summary: "orphan summary",
  });
  state.activeBlockIds.add(1);

  const result = applyCompressedBlockRetention(state, [], new Set(), defaultConfig);

  assert.deepEqual(result.deactivatedBlockIds, [1]);
  assert.equal(state.blocks.get(1)?.active, false);
  assert.equal(state.activeBlockIds.has(1), false);
});

test("deactivates net-negative compression blocks", () => {
  const state = createInitialState();
  state.blocks.set(1, {
    blockId: 1,
    runId: 1,
    active: true,
    topic: "bad",
    mode: "range",
    startRef: "m0001",
    endRef: "m0001",
    anchorEntryId: "e1",
    originEntryId: "origin",
    directEntryIds: ["e1"],
    effectiveEntryIds: ["e1"],
    directToolCallIds: [],
    effectiveToolCallIds: [],
    consumedBlockIds: [],
    compressedTokens: 10,
    summaryTokens: 12,
    createdAt: 1,
    createdTurn: 1,
    summary: "larger than raw",
  });
  state.activeBlockIds.add(1);

  const frames = [{ ref: "m0001", entryId: "e1", message: { role: "user", content: "x" }, tokenCount: 10, toolCallIds: [], role: "user" }];
  const result = applyCompressedBlockRetention(state, frames, new Set(), defaultConfig);

  assert.deepEqual(result.deactivatedBlockIds, [1]);
});

test("deactivates blocks fully covered by stale tool stripping", () => {
  const state = createInitialState();
  state.blocks.set(1, {
    blockId: 1,
    runId: 1,
    active: true,
    topic: "tool only",
    mode: "range",
    startRef: "m0001",
    endRef: "m0002",
    anchorEntryId: "e1",
    originEntryId: "origin",
    directEntryIds: ["e1", "e2"],
    effectiveEntryIds: ["e1", "e2"],
    directToolCallIds: ["call_old"],
    effectiveToolCallIds: ["call_old"],
    consumedBlockIds: [],
    compressedTokens: 500,
    summaryTokens: 50,
    createdAt: 1,
    createdTurn: 1,
    summary: "tool transcript summary",
  });
  state.activeBlockIds.add(1);

  const frames = [
    { ref: "m0001", entryId: "e1", message: { role: "assistant", content: [{ type: "toolCall", id: "call_old", name: "bash", arguments: {} }] }, tokenCount: 50, toolCallIds: ["call_old"], role: "assistant" },
    { ref: "m0002", entryId: "e2", message: { role: "toolResult", toolCallId: "call_old", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false }, tokenCount: 450, toolCallIds: ["call_old"], role: "toolResult" },
  ];

  const result = applyCompressedBlockRetention(state, frames, new Set(["call_old"]), defaultConfig);

  assert.deepEqual(result.deactivatedBlockIds, [1]);
});
```

- [x] **Step 2: Implement block retention helper**

Create `src/modules/dcp/retention/compressed-blocks.ts`:

```ts
import type { DcpConfig } from "../config";
import type { ContextFrame, DcpState } from "../state/types";
import { deactivateBlock } from "../state/store";

export interface CompressedBlockRetentionResult {
  deactivatedBlockIds: number[];
}

export function applyCompressedBlockRetention(
  state: DcpState,
  frames: ContextFrame[],
  staleToolCallIds: Set<string>,
  _config: DcpConfig,
): CompressedBlockRetentionResult {
  const frameEntryIds = new Set(frames.map((frame) => frame.entryId));
  const deactivatedBlockIds: number[] = [];

  for (const blockId of [...state.activeBlockIds]) {
    const block = state.blocks.get(blockId);
    if (!block || !block.active) continue;

    const hasBranchEntries = block.effectiveEntryIds.some((entryId) => frameEntryIds.has(entryId));
    const isNetNegative = block.summaryTokens >= block.compressedTokens;
    const isOnlyStaleTools =
      block.effectiveToolCallIds.length > 0 &&
      block.effectiveToolCallIds.every((id) => staleToolCallIds.has(id)) &&
      block.effectiveEntryIds.every((entryId) => {
        const frame = frames.find((item) => item.entryId === entryId);
        return frame?.role === "assistant" || frame?.role === "toolResult";
      });

    if (!hasBranchEntries || isNetNegative || isOnlyStaleTools) {
      deactivateBlock(state, blockId);
      deactivatedBlockIds.push(blockId);
    }
  }

  return { deactivatedBlockIds };
}
```

- [x] **Step 3: Invoke retention before summary injection**

In `transformMessagesForContext()`, after computing `staleToolCallIds`, call:

```ts
  applyCompressedBlockRetention(input.state, input.frames, staleToolCallIds, config);
```

Then compute `activeBlocks` after retention, not before.

- [x] **Step 4: Run tests**

Run:

```bash
npm test -- tests/modules/dcp/compressed-block-retention.test.ts tests/modules/dcp/context-transform.test.ts
```

Expected: PASS.

---

## Task 5: Enforce age-tier compression budgets

**Files:**
- Modify: `src/modules/dcp/compress/state.ts`
- Modify: `src/modules/dcp/tools/compress.ts`
- Modify: `tests/modules/dcp/compress-range.test.ts`
- Add: `tests/modules/dcp/compression-tiers.test.ts`

- [x] **Step 1: Write failing compression tier tests**

Create `tests/modules/dcp/compression-tiers.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/modules/dcp/state/store";
import { applyRangeCompression } from "../../../src/modules/dcp/compress/state";
import { defaultConfig } from "../../../src/modules/dcp/config";

test("rejects summaries that exceed the age-tier budget", () => {
  const state = createInitialState();
  state.turnCounter = 20;
  state.messageTurns.set("e1", 1);
  const frames = [{ ref: "m0001", entryId: "e1", message: { role: "user", content: "x" }, tokenCount: 100, toolCallIds: [], role: "user" }];

  assert.throws(
    () => applyRangeCompression(state, frames, "origin", {
      topic: "old work",
      content: [{ startId: "m0001", endId: "m0001", summary: "x ".repeat(80) }],
    }, defaultConfig),
    /Compression summary too long/,
  );
});

test("allows summaries within the selected age-tier budget", () => {
  const state = createInitialState();
  state.turnCounter = 20;
  state.messageTurns.set("e1", 1);
  const frames = [{ ref: "m0001", entryId: "e1", message: { role: "user", content: "x" }, tokenCount: 1000, toolCallIds: [], role: "user" }];

  const result = applyRangeCompression(state, frames, "origin", {
    topic: "old work",
    content: [{ startId: "m0001", endId: "m0001", summary: "short durable summary" }],
  }, defaultConfig);

  assert.deepEqual(result.blockIds, [1]);
});
```

- [x] **Step 2: Modify apply signatures**

Change signatures in `src/modules/dcp/compress/state.ts`:

```ts
export function applyRangeCompression(
  state: DcpState,
  frames: ContextFrame[],
  originEntryId: string,
  args: RangeCompressionArgs,
  config: DcpConfig,
): CompressionApplyResult
```

And similarly for `applyMessageCompression(...)`.

- [x] **Step 3: Enforce budget in `createBlock()`**

Import age helpers and `DcpConfig`. Add `config` to `createBlock()` input. Before creating the block:

```ts
  const ageTurns = getYoungestFrameAgeTurns(state, input.frames, state.turnCounter);
  const tier = selectSummaryTier(input.config.compress.summaryTiers, ageTurns);
  const maxSummaryTokens = Math.max(1, Math.floor(compressedTokens * tier.maxSummaryRatio));
  if (summaryTokens > maxSummaryTokens) {
    throw new Error(
      `Compression summary too long for ${ageTurns}-turn-old content: ${summaryTokens} estimated tokens exceeds ${maxSummaryTokens} (${Math.round(tier.maxSummaryRatio * 100)}% tier)`,
    );
  }
```

Stamp blocks:

```ts
    createdTurn: state.turnCounter,
```

- [x] **Step 4: Pass config from tool and update existing tests**

In `src/modules/dcp/tools/compress.ts`, pass `config` into `applyRangeCompression`/`applyMessageCompression`.

In existing compression tests, pass `defaultConfig` as the final argument.

- [x] **Step 5: Run tests**

Run:

```bash
npm test -- tests/modules/dcp/compress-range.test.ts tests/modules/dcp/compression-tiers.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 6: Prompt, docs, schema, and final verification

**Files:**
- Modify: `src/modules/dcp/prompts.ts`
- Modify: `src/modules/dcp/tools/compress.ts`
- Modify: `README.md`
- Modify: `config/pi-ext.example.jsonc`
- Modify: `schema/pi-ext.schema.json`

- [x] **Step 1: Update DCP system prompt**

Replace `SYSTEM_PROMPT` body with guidance that includes:

```ts
export const SYSTEM_PROMPT = `You operate in a context-constrained Pi coding session. Manage context continuously to avoid buildup and preserve retrieval quality.

The context-management tool is \`compress\`. It replaces older visible conversation content with dense technical summaries that you write.

DCP automatically strips old tool-call/tool-result transcripts after the configured stale-tool threshold (default 5 turns). Do not spend compression budget summarizing old raw tool outputs unless their conclusions are required for future work.

When compressing, use stricter summaries for older content:
- fresh stale work: preserve exact technical details, but avoid transcripts;
- warm work (5+ turns old): keep decisions, file paths, commands, failures, and next actions only;
- cold work (15+ turns old): keep only durable facts that affect future edits.
`;
```

- [x] **Step 2: Update `compress` tool prompt snippets**

In `src/modules/dcp/tools/compress.ts`, add snippets similar to:

```ts
"Do not compress old raw tool-call transcripts; DCP strips them after the stale-tool threshold.",
"Older selections must use shorter summaries. If the tool rejects an over-budget summary, retry with only durable facts.",
```

- [x] **Step 3: Document config**

Add README config example under the existing DCP config section:

```jsonc
{
  "modules": {
    "dcp": {
      "config": {
        "strategies": {
          "staleToolCalls": {
            "enabled": true,
            "turns": 5,
            "protectedTools": ["read", "edit", "write"]
          }
        },
        "compress": {
          "summaryTiers": [
            { "minTurns": 0, "maxSummaryRatio": 0.4 },
            { "minTurns": 5, "maxSummaryRatio": 0.25 },
            { "minTurns": 15, "maxSummaryRatio": 0.12 }
          ]
        }
      }
    }
  }
}
```

- [x] **Step 4: Update schema**

In `schema/pi-ext.schema.json`, add permissive typed properties under `modules.dcp.config.properties` for:

- `strategies.staleToolCalls.enabled`
- `strategies.staleToolCalls.turns`
- `strategies.staleToolCalls.protectedTools`
- `compress.summaryTiers[].minTurns`
- `compress.summaryTiers[].maxSummaryRatio`

Keep `additionalProperties: true` for forward compatibility.

- [x] **Step 5: Final verification**

Run:

```bash
npm test -- tests/modules/dcp/*.test.ts
npm run typecheck
npm run build
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dcp tests/modules/dcp README.md config/pi-ext.example.jsonc schema/pi-ext.schema.json
git commit -m "feat(dcp): strip stale tools and tier compression retention"
```

---

## Acceptance criteria

- Tool call/result artifacts older than 5 DCP turns are removed from outgoing context by default.
- Matching assistant `toolCall` and `toolResult` messages are stripped together; no dangling provider payload pairs are produced.
- Protected tools can be exempted by config.
- Active compression blocks that are orphaned, net-negative, or only summarize stale tool artifacts are deactivated before context injection.
- New compression summaries are rejected when they exceed the configured age-tier ratio.
- Existing sessions without the new state fields continue to load.
- README, example config, and schema describe the new behavior.
