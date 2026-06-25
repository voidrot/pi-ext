# In-Process Subagents Module Architecture Plan

> **For implementers:** this is the architecture-first version of the plan. Do not start implementation until the lifecycle, persistence, and child-extension decisions below are accepted.

## Goal

Add an `agents` module to `@voidrot/pi-ext` that makes main Pi sessions orchestrators by default and lets them delegate work to in-process child Pi SDK sessions discovered from `~/.pi/agent/agents/*.md`.

Sub-agents must be observable by the parent session: every child run has a durable record, a persisted transcript when possible, lifecycle events, foreground tool progress, and background notifications for completion/failure/stall/abort.

## Core architecture

The module is split into five layers:

1. **Agent catalog** — discovers and validates markdown agent definitions from `~/.pi/agent/agents/*.md`.
2. **Run manager** — owns all child run records, concurrency limits, lifecycle state, stall timers, and result lookup.
3. **Child session factory** — creates in-process `AgentSession`s with Pi SDK APIs, persistent child `SessionManager`s, explicit tool filtering, and controlled extension loading.
4. **Tools** — expose orchestration primitives to the parent agent: `run_subagent`, `get_subagent_result`, and `steer_subagent`.
5. **Notification bridge** — publishes lifecycle events and sends parent-session messages when background children complete, fail, abort, or stall.

The parent session stays authoritative. Child sessions never become orchestrators themselves, even when child extensions are loaded.

## Revised design decisions

### 1. Child extension loading: controlled inheritance, not blanket disablement

Initial draft used `noExtensions: true`. That is safe but too limiting: sub-agents could not use extension-provided tools the user expects. The refined architecture uses an explicit policy:

```ts
childExtensions: {
  mode: "inherit-safe" | "none";
  recursiveToolDenylist: ["run_subagent", "get_subagent_result", "steer_subagent"];
}
```

Default: `inherit-safe`.

`inherit-safe` means:

- create the child session with `DefaultResourceLoader` **without** `noExtensions: true`;
- still suppress prompt templates, themes, and context files for deterministic child prompts:
  - `noPromptTemplates: true`
  - `noThemes: true`
  - `noContextFiles: true`
  - `systemPromptOverride: () => childSystemPrompt`
  - `appendSystemPromptOverride: () => []`
- create the child session with only the agent-requested tool names as the initial active tool set;
- call `session.bindExtensions({})` so extension tools can initialize;
- immediately apply a recursion guard with `session.getActiveToolNames()` + `session.setActiveToolsByName(filtered)`;
- deny recursive orchestration tools regardless of the agent markdown `tools` field;
- mark child session IDs in a child-session registry before extension binding, so this module's `before_agent_start` handler can skip orchestrator prompt injection for children.

`none` remains available as a hard-isolation mode for debugging or security-sensitive use. In that mode the loader uses `noExtensions: true`; children can only use built-in tools available through the SDK/session factory.

### 2. Persistent transcripts are first-class

Do not use only `SessionManager.inMemory()` except as a fallback in tests or headless cases. Child transcripts should use Pi's normal persisted session format.

Derive child session directories from the parent session file:

```text
<parent-session-dir>/<parent-session-basename>/tasks/
```

Example:

```text
~/.pi/agent/sessions/<project>/2026-06-24T12-00-00Z_.jsonl
~/.pi/agent/sessions/<project>/2026-06-24T12-00-00Z_/tasks/<child-session>.jsonl
```

Creation flow:

1. parent tool call snapshots `ctx.sessionManager.getSessionFile()` and `ctx.sessionManager.getSessionId()`;
2. derive child session dir from the parent session file;
3. create a persisted child `SessionManager` in that dir;
4. call `newSession({ parentSession: parentSessionId })`;
5. store `childSessionId`, `sessionDir`, and `outputFile` on the run record;
6. include the transcript path in foreground results and background notifications.

If the parent session is not persisted, fall back to a temp task directory keyed by cwd, matching the `pi-subagents` approach.

### 3. Foreground and background agents share one runtime

The same run manager should drive both foreground and background children. `run_subagent` gets an execution mode:

```ts
{
  agent?: string;
  prompt?: string;
  tasks?: Array<{ agent: string; prompt: string }>;
  chain?: Array<{ agent: string; prompt: string }>;
  background?: boolean;
}
```

Behavior:

- `background: false` or omitted: tool waits for completion and returns full/aggregated output.
- `background: true`: tool starts child runs, returns task IDs immediately, and relies on notifications plus `get_subagent_result` for follow-up.
- parallel foreground runs stream compact progress via `onUpdate`;
- parallel background runs produce one notification per child plus optional group-level summary when all siblings finish.

### 4. Parent notification is mandatory lifecycle behavior

Every child run transitions through explicit states:

```text
queued -> spawning -> running -> completed
                         |-> failed
                         |-> aborted
                         |-> stalled
                         |-> disposed
```

The module publishes internal Pi event-bus events and also notifies the parent agent when a background run reaches a terminal or attention-needed state.

Event channels:

```text
pi-ext:agents:child:queued
pi-ext:agents:child:spawning
pi-ext:agents:child:session-created
pi-ext:agents:child:running
pi-ext:agents:child:progress
pi-ext:agents:child:stalled
pi-ext:agents:child:completed
pi-ext:agents:child:failed
pi-ext:agents:child:aborted
pi-ext:agents:child:disposed
```

Notification delivery:

- foreground: `onUpdate` during execution; final tool result includes all statuses and transcript paths;
- background: `pi.sendMessage(...)` with `{ deliverAs: "followUp", triggerTurn: true }` so the main agent receives a machine-readable completion/failure/stall message and can act without user polling;
- custom message `customType`: `pi-ext-agents-notification`;
- message content uses a compact XML-ish block:

```xml
<subagent-notification>
  <task-id>...</task-id>
  <agent>scout</agent>
  <status>completed|failed|aborted|stalled</status>
  <summary>...</summary>
  <result>preview or error</result>
  <transcript>...</transcript>
</subagent-notification>
```

Notifications must include enough context for the parent agent to synthesize or recover:

- task id;
- agent name;
- prompt summary;
- status;
- result preview or error;
- transcript path;
- elapsed time;
- turn count;
- tool-use count if available.

### 5. Stall detection is separate from max-turn control

Max-turn control handles children that keep taking turns. Stall detection handles children that stop producing observable activity.

Track `lastActivityAt` from child session events:

- message start/update;
- tool call start/update/end;
- turn end;
- explicit session progress events if available.

Config:

```ts
stall: {
  enabled: true;
  timeoutMs: 120000;
  notify: true;
  abortAfterMs?: number;
}
```

On timeout:

1. mark the record `stalled`;
2. send a background notification or foreground update;
3. optionally `steer_subagent` automatically with a wrap-up prompt, if configured later;
4. optionally abort after `abortAfterMs`.

### 6. Child prompt isolation

Child prompt is built from the markdown body and optional parent context only by explicit request. Default child sessions do **not** inherit parent conversation context. This prevents accidental leakage and keeps child outputs focused.

Future config can add `inheritContext`, but the default remains isolated.

## Agent markdown contract

Supported shape:

```markdown
---
name: scout
description: Fast repository reconnaissance
tools: read, bash
model: anthropic/claude-haiku-4-5
thinking: off
max_turns: 8
extensions: inherit-safe
---
You are a focused reconnaissance sub-agent. Return concise findings with file paths.
```

Rules:

- `name` and `description` are required.
- `tools` is CSV; omitted means default safe built-ins; `tools: none` means no tools.
- recursive orchestration tools are always denied in child sessions.
- `model` must be `provider/modelId`; missing/unresolved inherits parent model.
- `thinking` accepts Pi thinking levels; invalid values are ignored.
- `max_turns` is a positive integer; enforced with soft steer and hard abort grace.
- `extensions` can override child extension policy per agent, but only within the global module policy.

## Config shape

```ts
modules: {
  agents: {
    enabled: true,
    orchestrator: { enabled: true },
    maxParallel: 4,
    defaultBackground: false,
    childExtensions: {
      mode: "inherit-safe",
      recursiveToolDenylist: ["run_subagent", "get_subagent_result", "steer_subagent"],
    },
    transcripts: {
      persist: true,
    },
    stall: {
      enabled: true,
      timeoutMs: 120000,
      notify: true,
    },
    tools: {
      runSubagent: { enabled: true },
      getSubagentResult: { enabled: true },
      steerSubagent: { enabled: true },
    },
  },
}
```

## File structure

- `src/core/modules.ts` — add `agents` module id.
- `src/core/config.ts` — add config/defaults/normalization.
- `src/core/tools.ts` — own `run_subagent`, `get_subagent_result`, `steer_subagent`.
- `src/modules/agents/definitions.ts` — discover/parse markdown agent definitions.
- `src/modules/agents/lifecycle.ts` — event channel constants, payload types, publisher.
- `src/modules/agents/records.ts` — run record model and state transitions.
- `src/modules/agents/session-dir.ts` — derive persistent child transcript directories.
- `src/modules/agents/session-factory.ts` — create SDK child sessions, bind extensions, apply recursion guard.
- `src/modules/agents/run-manager.ts` — queue/run foreground/background children, enforce concurrency, track stall timers.
- `src/modules/agents/notifications.ts` — parent follow-up notification formatting/sending.
- `src/modules/agents/tools/run-subagent.ts` — primary orchestration tool.
- `src/modules/agents/tools/get-subagent-result.ts` — retrieve full/preview result by task id.
- `src/modules/agents/tools/steer-subagent.ts` — send steer/abort-style instructions to live background child.
- `src/modules/agents/index.ts` — module registration and orchestrator prompt injection.

## Implementation sequence

1. **Config/tool ownership** — add `agents` config and own all three tools.
2. **Agent discovery** — parse global markdown agents and diagnostics.
3. **Lifecycle + records** — add run records, state transitions, event publisher, and transcript-dir derivation.
4. **Session factory** — create persistent child SDK sessions; implement `inherit-safe` and `none` extension policies; apply recursion guard.
5. **Run manager** — implement foreground/background execution, concurrency, max-turn control, abort cleanup, and stall timers.
6. **Notification bridge** — send parent follow-up messages for background completion/failure/abort/stall.
7. **Tools** — implement `run_subagent`, `get_subagent_result`, and `steer_subagent` against the run manager.
8. **Module wiring** — register tools and append orchestrator prompt only for non-child parent sessions.
9. **Docs/dogfood** — document agent files, execution modes, background notifications, and transcript paths.

## Acceptance criteria

- No child run shells out to `pi`.
- Main sessions receive orchestrator guidance by default.
- Child sessions are not recursively equipped with orchestration tools.
- Child sessions can load safe inherited extension tools by default.
- Child transcripts persist under the parent session when the parent is persisted.
- Foreground `run_subagent` streams progress and returns transcript paths.
- Background `run_subagent` returns task IDs immediately.
- Background completion/failure/abort/stall sends a follow-up notification that triggers the main agent.
- `get_subagent_result` can retrieve full output by task ID.
- `steer_subagent` can steer or abort a live background child.
- Tests cover discovery, config normalization, session-dir derivation, recursion guard, lifecycle state transitions, notifications, and tool validation without real model calls.
