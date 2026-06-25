# In-process subagents

`@voidrot/pi-ext` can make a parent Pi session an orchestrator and delegate work to child Pi SDK sessions in the same Node process.

## Agent files

Create markdown agents in:

```text
~/.pi/agent/agents/*.md
```

Example:

```markdown
---
name: scout
description: Fast read-only repository reconnaissance
tools: read, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: off
max_turns: 8
extensions: inherit-safe
---
You are a reconnaissance sub-agent. Inspect only what is needed. Return concise findings with exact file paths.
```

Supported frontmatter:

- `name` and `description` are required.
- `tools` is comma-separated; omitted defaults to `read,bash,edit,write`; `tools: none` disables tools.
- `model` is optional and must be `provider/modelId`; missing or unresolved inherits the parent model.
- `thinking` accepts Pi thinking levels.
- `max_turns` adds a soft turn-limit steer.
- `extensions` can be `inherit-safe` or `none`.

## Tools

### `run_subagent`

Single foreground task:

```json
{ "agent": "scout", "prompt": "Find where modules are registered." }
```

Parallel foreground tasks:

```json
{
  "tasks": [
    { "agent": "scout", "prompt": "Find config code." },
    { "agent": "scout", "prompt": "Find tool registration code." }
  ]
}
```

Background task:

```json
{ "agent": "scout", "prompt": "Audit the repo for TODOs.", "background": true }
```

Background runs return task IDs immediately. Completion, failure, abort, and stall states send a parent follow-up message with a machine-readable `<subagent-notification>` block.

### `get_subagent_result`

```json
{ "taskId": "subagent-..." }
```

Returns the stored output, status, and transcript path.

### `steer_subagent`

```json
{ "taskId": "subagent-...", "message": "Wrap up with only the highest-risk findings." }
```

Sends a steering message to a live background child.

## Transcripts

When the parent session is persisted, child transcripts are stored under:

```text
<parent-session-dir>/<parent-session-basename>/tasks/
```

If the parent is not persisted, the module falls back to a temp task directory keyed by cwd.

## Extension loading

Default child extension mode is `inherit-safe`:

- child sessions load inherited Pi extensions;
- context files, prompt templates, and themes are suppressed for deterministic child prompts;
- recursive orchestration tools are removed from children: `run_subagent`, `get_subagent_result`, `steer_subagent`.

Set `modules.agents.childExtensions.mode` or agent `extensions: none` to disable child extension loading.
