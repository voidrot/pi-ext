# @voidrot/pi-ext

A single Pi.dev package that hosts Voidrot Pi extensions, workflow modules, and tools.

## What is included

- `dcp` — Dynamic Context Pruning for Pi sessions.
  - Registers `/dcp`, `/dcp-stats`, and `/dcp-compress` commands.
  - Registers the `compress` tool when enabled.
  - Rewrites outgoing model context with durable summaries while preserving the session file.
- `dashboard` — local background dashboard webserver.
  - Starts on session start and opens `http://127.0.0.1:<port>/` by default.
  - Uses Hono for routing/server rendering and Hono JSX for the dashboard page.
  - Uses Tailwind v4 browser CSS with shadcn-style primitives for placeholder UI cards/actions.
  - Serves placeholder extension/runtime/storage status at `/`, JSON at `/api/status`, and health at `/healthz`.
  - Provides a foundation for future DCP global/project SQLite statistics.
- `agents` — in-process subagents for orchestrated Pi sessions.
  - Discovers markdown agents from `~/.pi/agent/agents/*.md`.
  - Registers `run_subagent`, `get_subagent_result`, and `steer_subagent` when enabled.
  - Persists child transcripts under the parent session task directory when possible.
  - Sends parent follow-up notifications when background children complete, fail, abort, or stall.
- `memory` — global, project, and session-scoped memories.
  - Registers `create_global_memory`, `create_project_memory`, `create_session_memory`, and `search_memories` when enabled.
  - Stores global memories in the global SQLite database.
  - Stores project/session memories in trusted project SQLite databases.
  - Indexes memories with sqlite-vec in a background worker after memory tools return.
  - Supports local lexical embeddings or external Ollama `/api/embed` endpoints for vector creation/search.
  - Injects compact saved memories into new session prompts.

## Install locally for development

```bash
npm install
npm run build
pi -e .
```

## Install as a Pi package

```bash
pi install /absolute/path/to/pi-ext
```

Or add this repository path to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["/absolute/path/to/pi-ext"]
}
```

## Pi package manifest

This repository exposes exactly one Pi extension entrypoint:

```json
{
  "pi": { "extensions": ["./dist/index.js"] }
}
```

That single extension owns config loading, module registration, and tool enable/disable reconciliation.

## Runtime config

Global config:

- `~/.pi/agent/pi-ext.json`
- `~/.pi/agent/pi-ext.jsonc`

Trusted project override:

- `.pi/pi-ext.json`
- `.pi/pi-ext.jsonc`

Project config is ignored until the project is trusted by Pi.

### Config precedence

| Order | Path | Loaded when |
| --- | --- | --- |
| 1 | Built-in defaults | Always |
| 2 | `~/.pi/agent/pi-ext.json` | File exists |
| 3 | `~/.pi/agent/pi-ext.jsonc` | File exists |
| 4 | `.pi/pi-ext.json` | File exists and project is trusted |
| 5 | `.pi/pi-ext.jsonc` | File exists and project is trusted |

Later files deep-merge over earlier files.

## Example config

See `config/pi-ext.example.jsonc`.

Minimal global config:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/voidrot/pi-ext/main/schema/pi-ext.schema.json",
  "enabled": true,
  "debug": false,
  "modules": {
    "dcp": {
      "enabled": true,
      "tools": {
        "compress": { "enabled": true }
      },
      "config": {
        "compress": {
          "permission": "allow",
          "maxContextLimit": "80%",
          "minContextLimit": "40%",
          "summaryTiers": [
            { "minTurns": 0, "maxSummaryRatio": 0.4 },
            { "minTurns": 5, "maxSummaryRatio": 0.25 },
            { "minTurns": 15, "maxSummaryRatio": 0.12 }
          ]
        },
        "strategies": {
          "staleToolCalls": {
            "enabled": true,
            "turns": 5,
            "protectedTools": ["read", "edit", "write"]
          }
        },
        "ui": {
          "compressedBlocksWidget": true,
          "compressionNotifications": true
        }
      }
    },
    "dashboard": {
      "enabled": true,
      "server": {
        "host": "127.0.0.1",
        "port": "auto",
        "portRange": { "start": 17380, "end": 17480 }
      },
      "browser": {
        "openOnStart": true,
        "reopenOnSessionChange": false
      }
    },
    "agents": {
      "enabled": true,
      "orchestrator": { "enabled": true },
      "tools": {
        "runSubagent": { "enabled": true },
        "getSubagentResult": { "enabled": true },
        "steerSubagent": { "enabled": true }
      },
      "maxParallel": 4,
      "childExtensions": { "mode": "inherit-safe" },
      "transcripts": { "persist": true },
      "stall": { "enabled": true, "timeoutMs": 120000, "notify": true }
    },
    "memory": {
      "enabled": true,
      "prompt": { "enabled": true, "maxMemoriesPerScope": 12, "maxContentChars": 500 },
      "tools": {
        "createGlobalMemory": { "enabled": true },
        "createProjectMemory": { "enabled": true },
        "createSessionMemory": { "enabled": true },
        "searchMemories": { "enabled": true }
      },
      "vector": {
        "enabled": true,
        "provider": "local",
        "dimensions": 256,
        "searchLimit": 8,
        "background": { "enabled": true, "batchSize": 10 },
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

For global DCP-only settings, top-level `dcp` is also accepted as shorthand for `modules.dcp.config`:

```jsonc
{
  "dcp": {
    "ui": { "compressedBlocksWidget": false }
  }
}
```

## Enable/disable examples

Disable all `@voidrot/pi-ext` behavior:

```jsonc
{
  "enabled": false
}
```

Disable only Dynamic Context Pruning:

```jsonc
{
  "modules": {
    "dcp": { "enabled": false }
  }
}
```

Disable browser auto-open while keeping the local dashboard server available:

```jsonc
{
  "modules": {
    "dashboard": {
      "browser": { "openOnStart": false }
    }
  }
}
```

Use a fixed dashboard port:

```jsonc
{
  "modules": {
    "dashboard": {
      "server": { "host": "127.0.0.1", "port": 17380 }
    }
  }
}
```

Disable only the DCP `compress` tool:

```jsonc
{
  "modules": {
    "dcp": {
      "tools": { "compress": { "enabled": false } }
    }
  }
}
```

Disable DCP UI surfaces while keeping compression active:

```jsonc
{
  "modules": {
    "dcp": {
      "config": {
        "ui": {
          "compressedBlocksWidget": false,
          "compressionNotifications": false
        }
      }
    }
  }
}
```

## SQLite storage

`@voidrot/pi-ext` uses SQLite through Kysely for extension-owned persistent state.

- Global database: `~/.pi/pi-ext.db`
- Project database: `.pi/pi-ext.db` in trusted projects

Core and modules register migrations at extension startup. Table model files declare whether a table belongs to the global or project database by augmenting `GlobalDatabase` or `ProjectDatabase` from `src/core/database/schema.ts` and exporting a `defineTableModel({ scope, tableName })` descriptor.

## Commands

- `/pi-ext status` — show top-level module/tool enable state.
- `/pi-ext config` — show merged runtime config.
- `/pi-ext reload` — reload `pi-ext.json[c]` without restarting Pi.
- `/dashboard` — open the local Pi Ext dashboard in the system browser.
- `/dcp` — show/control DCP state (`/dcp stats` also opens the stats overlay).
- `/dcp-stats` — open a high-definition overlay with block and token statistics.
- `/dcp-compress` — ask the model to run one DCP compression pass.

## Development

```bash
npm test
npm run typecheck
npm run build
```
