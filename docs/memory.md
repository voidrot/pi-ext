# Memory module

The memory module lets an agent save durable memories at three scopes and search them with sqlite-vec backed vector indexes.

## Scopes

- **Global memories** are stored in the global Pi Ext database and apply across projects.
- **Project memories** are stored in the trusted project's `.pi/pi-ext.db` and apply to that repository.
- **Session memories** are stored in the trusted project's `.pi/pi-ext.db` with the current Pi session ID and apply only to the current session.

Project and session memories require a trusted project because they write to the project database.

## Tools

### `create_global_memory`

Use for stable cross-project preferences or facts.

```json
{ "content": "Prefer concise answers unless I ask for detail.", "tags": ["style"], "importance": 4 }
```

### `create_project_memory`

Use for repository-specific facts, commands, conventions, or architecture notes.

```json
{ "content": "This repo uses npm test and npm run typecheck for validation.", "tags": ["commands"], "importance": 4 }
```

### `create_session_memory`

Use for temporary constraints or decisions that should apply only to the current session.

```json
{ "content": "For this session, only plan the memory module; do not implement it yet.", "tags": ["session"], "importance": 5 }
```

### `search_memories`

Search saved memories with sqlite-vec vector similarity. By default pi-ext uses a local deterministic lexical embedder, but vector creation and search can also use an external Ollama embedding endpoint.

```json
{ "query": "package manager preference", "scopes": ["global", "project"], "limit": 5 }
```

Memory creation tools return after the memory row is stored. Vector indexing is queued in a background worker, so slow external embedding endpoints do not block the tool call. Until indexing completes, a newly created memory may not appear in `search_memories`, but it is still available for prompt injection by recency/importance.

## Prompt injection

At session start, Pi Ext injects a compact list of recent/high-importance global, project, and matching session memories into the system prompt when `modules.memory.prompt.enabled` is true.

Prompt injection still uses recent/high-importance ordering. Use `search_memories` when you need a specific saved memory that may not be included in the injected prompt.

## Dashboard view

The local dashboard includes a stored-memory browser at `/memories`. It has a combined view plus `/memories/global`, `/memories/project`, and `/memories/session` scope views. JSON payloads are available at `/api/memories` and `/api/memories/:scope`.

The dashboard reads global and trusted-project memories directly from the same databases used by the tools. The session scope is filtered to the current Pi session ID.

Prompt injection limits, vector search defaults, background indexing, and external embedding providers are configurable with:

```jsonc
{
  "modules": {
    "memory": {
      "prompt": {
        "maxMemoriesPerScope": 12,
        "maxContentChars": 500
      },
      "tools": {
        "searchMemories": { "enabled": true }
      },
      "vector": {
        "enabled": true,
        "provider": "ollama",
        "dimensions": 256,
        "searchLimit": 8,
        "background": {
          "enabled": true,
          "batchSize": 10
        },
        "ollama": {
          "endpoint": "http://127.0.0.1:11434",
          "model": "nomic-embed-text",
          "timeoutMs": 30000
        }
      }
    }
  }
}
```
