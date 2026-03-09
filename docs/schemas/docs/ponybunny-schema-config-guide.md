# `ponybunny.schema.json` Configuration Guide

This guide explains every configuration item in `docs/schemas/ponybunny.schema.json`, what it controls, and how it affects runtime behavior.

## Purpose

`ponybunny.json` is the system runtime config. It controls core process wiring (gateway/scheduler), runtime rollout, agent defaults, memory backend, TUI behavior, and debug toggles.

## Full Example

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/ponybunny.schema.json",
  "paths": {
    "database": "~/.ponybunny/pony.db",
    "schedulerSocket": "~/.ponybunny/gateway.sock"
  },
  "gateway": {
    "host": "127.0.0.1",
    "port": 18789
  },
  "scheduler": {
    "tickIntervalMs": 1000,
    "maxConcurrentGoals": 5,
    "agentsEnabled": true,
    "deterministicRuntimeEnabled": false,
    "planCompilerEnabled": false,
    "toolRoutingMode": "system_preferred",
    "allowModelNativeTools": false,
    "runtimeRollout": {
      "shadowModeEnabled": false,
      "canaryPercent": 0,
      "rollbackOnFailure": true,
      "lanePercents": {
        "dryRun": 0,
        "compile": 0,
        "replay": 0
      }
    },
    "runEventRetention": {
      "enabled": true,
      "intervalMs": 3600000,
      "maxAgeMs": 604800000,
      "keepLatestPerRun": 50
    }
  },
  "agent": {
    "mainAgentId": "lead",
    "personaEnabled": false,
    "modelOverrides": {
      "lead": "openai.gpt-5.3",
      "planning": "AUTO"
    }
  },
  "persona": {
    "directory": "~/.config/ponybunny/personas",
    "defaultPersonaId": "pony-default",
    "promptOverrides": {
      "personalityDescription": "",
      "communicationStyleDescription": "",
      "expertiseDescription": "",
      "guidelines": "",
      "backstory": ""
    }
  },
  "debug": {
    "serverPort": 3001,
    "loggingEnabled": false,
    "antigravityDebug": false
  },
  "memory": {
    "backend": "sqlite",
    "database": "~/.ponybunny/memory.db",
    "userProfileId": "local-default-user",
    "autoSave": true,
    "embeddingProvider": "none",
    "vectorWeight": 0.7,
    "keywordWeight": 0.3
  },
  "tui": {
    "inputBackgroundColor": "black",
    "sessionFirstEnabled": true,
    "goalSubmitFastPathEnabled": false
  }
}
```

## Top-Level Fields

- `$schema`: Schema URI used by editors/validation tooling.
- `paths`: Core file/socket paths used by gateway + scheduler runtime.
- `gateway`: Network bind settings for gateway server.
- `scheduler`: Runtime loop, rollout, and retention behavior.
- `agent`: Global agent defaults and per-agent model overrides.
- `persona`: Persona storage and prompt customization defaults.
- `debug`: Debug server and debug feature toggles.
- `memory`: Memory backend and retrieval weighting strategy.
- `tui`: TUI interaction mode and visual behavior.

## Field-by-Field Reference

### `paths`

- `database` (`string`): Main scheduler/work-order DB path.
- `schedulerSocket` (`string`): IPC socket path used between gateway and scheduler.

### `gateway`

- `host` (`string`): Host/interface to bind gateway service.
- `port` (`integer >= 1`): Gateway port.

### `scheduler`

- `tickIntervalMs` (`integer >= 1`): Scheduler tick frequency.
- `maxConcurrentGoals` (`integer >= 1`): Concurrency cap for active goals.
- `agentsEnabled` (`boolean`): Enable agent-driven execution.
- `deterministicRuntimeEnabled` (`boolean`): Enable deterministic runtime mode.
- `planCompilerEnabled` (`boolean`): Enable plan compiler pipeline.
- `toolRoutingMode` (`legacy|system_only|system_preferred|model_preferred`): Tool routing strategy.
  - `legacy`: compatibility baseline / rollback-safe mode.
  - `system_only`: only system-governed tool routing; model-native tools are effectively disallowed for routing decisions.
  - `system_preferred`: system routing first, model-native tool path allowed only as secondary fallback when policy permits.
  - `model_preferred`: model-native tool path is preferred first; highest flexibility, lowest conservatism.
  - Relative strictness order (from conservative to aggressive): `legacy < system_only < system_preferred < model_preferred`.
- `allowModelNativeTools` (`boolean`): Permit native model tools in routing path.

#### `scheduler.runtimeRollout`

- `shadowModeEnabled` (`boolean`): Run shadow evaluation path.
- `canaryPercent` (`0-100`): Traffic canary ratio.
- `rollbackOnFailure` (`boolean`): Roll back rollout mode after failures.
- `lanePercents.dryRun|compile|replay` (`0-100` each): Lane distribution controls.

#### `scheduler.runEventRetention`

- `enabled` (`boolean`): Enable event pruning job.
- `intervalMs` (`integer >= 1`): Prune interval.
- `maxAgeMs` (`integer >= 1`): Age threshold for pruning.
- `keepLatestPerRun` (`0-10000`): Keep newest N events per run.

### `agent`

- `mainAgentId` (`string`): Default agent ID when no explicit target is supplied.
- `personaEnabled` (`boolean`): Enable persona-aware behavior in runtime flows.
- `modelOverrides` (`object<string,string>`): Per-agent hard model override map.
  - Key: agent ID.
  - Value: model ID or `AUTO`.
  - Runtime effect: highest-priority model source for that agent; `AUTO` disables explicit override and falls back to next priority.

### `persona`

- `directory` (`string`): Persona files directory.
- `defaultPersonaId` (`string`): Persona used when user/session does not specify one.
- `promptOverrides` (`object`): Default prompt text overrides.
  - `personalityDescription`
  - `communicationStyleDescription`
  - `expertiseDescription`
  - `guidelines`
  - `backstory`

### `debug`

- `serverPort` (`integer >= 1`): Debug service port.
- `loggingEnabled` (`boolean`): Enable debug logging pipeline.
- `antigravityDebug` (`boolean`): Toggle specialized debug mode.

### `memory`

- `backend` (`sqlite|memory`): Memory persistence backend.
- `database` (`string`): Memory database path (when backend requires storage).
- `userProfileId` (`string`): Default user profile key for memory namespace.
- `autoSave` (`boolean`): Auto-persist memory updates.
- `embeddingProvider` (`none|openai|custom:https://...`): Embedding provider mode.
- `vectorWeight` (`0-1`): Vector similarity contribution weight.
- `keywordWeight` (`0-1`): Keyword match contribution weight.

### `tui`

- `inputBackgroundColor` (`gray|black|blue|green|yellow|magenta|cyan|white`): Input panel color.
- `sessionFirstEnabled` (`boolean`): Force session-first interaction mode.
- `goalSubmitFastPathEnabled` (`boolean`): Enable fast-path goal submission behavior.

## Important Constraints

- `additionalProperties: false` is enforced in most objects; unknown fields are rejected.
- Keep `vectorWeight + keywordWeight` logically balanced for retrieval quality.
- `modelOverrides` should prefer `AUTO` over deleting keys if you want explicit fallback semantics.
