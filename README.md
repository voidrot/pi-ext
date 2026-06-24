# @voidrot/pi-ext

A single Pi.dev package that hosts Voidrot Pi extensions, workflow modules, and tools.

## What is included

- `dcp` — Dynamic Context Pruning for Pi sessions.
  - Registers `/dcp` and `/dcp-compress` commands.
  - Registers the `compress` tool when enabled.
  - Rewrites outgoing model context with durable summaries while preserving the session file.

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
          "minContextLimit": "40%"
        }
      }
    }
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

## Commands

- `/pi-ext status` — show top-level module/tool enable state.
- `/pi-ext config` — show merged runtime config.
- `/pi-ext reload` — reload `pi-ext.json[c]` without restarting Pi.
- `/dcp` — show/control DCP state.
- `/dcp-compress` — ask the model to run one DCP compression pass.

## Development

```bash
npm test
npm run typecheck
npm run build
```
