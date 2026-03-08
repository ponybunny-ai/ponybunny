# `agent.schema.json` Configuration Guide

This guide explains every configuration field in `docs/schemas/agent.schema.json`.

## Purpose

`agent.json` defines one agent: identity, scheduling, policy controls, runtime runner config, UI metadata, and type-specific constraints (`mission_lead`, `growth`, `delivery`, `compliance`, `support_ops`, or future custom types).

## Minimal Valid Example

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/agent.schema.json",
  "schemaVersion": 1,
  "id": "lead",
  "name": "Lead",
  "description": "Mission lead agent",
  "enabled": true,
  "type": "mission_lead",
  "subAgents": ["planning", "execution"],
  "schedule": {
    "enabled": false,
    "everyMs": 60000,
    "catchUp": { "mode": "coalesce" }
  },
  "policy": {
    "toolAllowlist": ["bash", "read", "grep"],
    "forbiddenPatterns": [],
    "prompts": {
      "classify_system": "...",
      "route_system": "...",
      "conflict_system": "...",
      "brief_system": "..."
    },
    "limits": {
      "event_summary_max_chars": 2000,
      "evidence_excerpt_max_chars": 2000,
      "approval_pack_max_chars": 2000,
      "brief_section_max_items": 20,
      "conflict_markers_max_items": 20
    }
  },
  "runner": {
    "engine": "default",
    "config": {
      "tick_defaults": {
        "max_events_per_tick": 20,
        "max_brief_items": 10,
        "default_lookback_window": "24h"
      },
      "thresholds": {
        "quote_founder_approval_gbp": 1000,
        "payment_founder_approval_gbp": 1000,
        "deadline_critical_days": 3,
        "deadline_high_days": 7
      },
      "conflict_rules": {
        "hold_on_scope_mismatch": true,
        "hold_on_missing_invoice_evidence": true,
        "hold_on_filing_without_required_docs": true
      },
      "circuit_breaker": {
        "failure_threshold": 3,
        "backoff_minutes": 15
      }
    }
  }
}
```

## Base Object Fields

- `$schema` (`uri`, required): Schema URI.
- `schemaVersion` (`integer >= 1`, required): Agent definition version.
- `id` (`^[a-z][a-z0-9_-]{1,63}$`, required): Agent ID.
- `name` (`1-64 chars`, required): Display name.
- `description` (max 5 words, <= 80 chars, required): Short UI summary.
- `enabled` (`boolean`, required): Runtime enable switch.
- `type` (`string`, required): Capability type (for example `mission_lead`).
- `workdir` (`string`, optional): Agent working directory override.
- `subAgents` (`string[]`, unique, required): Agent IDs this agent may dispatch.
- `schedule` (required): Scheduling config object.
- `policy` (required): Security/prompt/limits policy object.
- `runner` (required): Runtime runner definition.
- `ui` (optional): UI metadata.
- `tags` (optional): Up to 20 unique classification tags.
- `meta` (optional): Free-form metadata object.

## `schedule` Fields

- `enabled` (`boolean`, default false): Enable schedule-driven execution.
- `everyMs` (`integer >= 1000`, required): Tick interval.
- `jitterMs` (`integer >= 0`, optional): Startup jitter to reduce herd effects.
- `timezone` (`string`, optional): IANA timezone for time windows.
- `catchUp.mode` (`coalesce|replay|skip`, required): Missed tick recovery strategy.
- `catchUp.maxReplayTicks` (`integer >= 1`, optional): Replay cap in replay mode.
- `windows[]` (optional): Allowed local-time run windows.
  - `days[]`: `mon..sun`, unique, 1-7 entries.
  - `start` / `end`: `HH:mm` 24-hour format.

## `policy` Fields

- `toolAllowlist` (`string[]`, required): Allowed tool IDs.
- `toolDenylist` (`string[]`, optional): Explicitly denied tool IDs.
- `skills` (`skillResourcePolicy`, optional): Skill allow/deny pattern sets.
- `mcp` (`mcpResourcePolicy`, optional): MCP resource allow/deny pattern sets.
- `forbiddenPatterns[]` (required): Pattern guards.
  - `pattern` (required), `description` (required), `severity` (`low|medium|high|critical`).
- `prompts` (`object<string,string>`, required): Stage prompt texts.
- `limits` (`object<string, number|boolean|string>`, required): Runtime limits.
- `approval` (`approvalPolicy`, optional): Approval requirement settings.
  - `required` (`boolean`), `actions[]`, `thresholds` map.
- `privacy` (`privacyPolicy`, optional): Privacy defaults.
  - `redactPiiByDefault` (`boolean`)
  - `allowedDataClasses[]` (`public|internal|customer|financial|hr|compliance|sensitive`)

## `runner` Fields

- `engine` (`string`, required): Runner backend ID.
- `entrypoint` (`string`, optional): Runner entrypoint selector.
- `config` (`object`, required): Type-specific runner config.

### Common `runner.config` Base

- `tick_defaults.max_events_per_tick` (`integer >= 1`, required)
- `tick_defaults.default_lookback_window` (`^[0-9]+[smhd]$`, required)
- `tick_defaults.max_brief_items` (`integer >= 1`, optional)
- `tick_defaults.max_tasks_per_tick` (`integer >= 1`, optional)
- `thresholds` (`object`, optional): Numeric/boolean/string thresholds.
- `conflict_rules` (`object<string,boolean>`, optional): Conflict toggles.
- `circuit_breaker.failure_threshold` (`integer >= 1`, required)
- `circuit_breaker.backoff_minutes` (`integer >= 1`, required)

## `ui` Fields

- `icon` (`string`, optional): Icon key.
- `accent` (`hex color`, optional): UI accent color.
- `order` (`integer >= 0`, optional): Sort order.
- `group` (`string`, optional): UI grouping key.

## Type-Specific Validation Rules

`typeSpecificValidation` enforces stricter required keys for known agent types.

### `mission_lead`

- `policy.prompts` must include:
  - `classify_system`, `route_system`, `conflict_system`, `brief_system`
- `policy.limits` must include:
  - `event_summary_max_chars`, `evidence_excerpt_max_chars`, `approval_pack_max_chars`, `brief_section_max_items`, `conflict_markers_max_items`
- `runner.config.thresholds` must include:
  - `quote_founder_approval_gbp`, `payment_founder_approval_gbp`, `deadline_critical_days`, `deadline_high_days`
- `runner.config.conflict_rules` must include:
  - `hold_on_scope_mismatch`, `hold_on_missing_invoice_evidence`, `hold_on_filing_without_required_docs`

### `growth` (`scoutRunnerConfig`)

Optional threshold keys:

- `hot_lead_score` (`0-100`)
- `follow_up_overdue_days` (`integer >= 0`)
- `quote_founder_approval_gbp` (`number >= 0`)

### `delivery` (`forgeRunnerConfig`)

Optional threshold keys:

- `milestone_slip_days` (`integer >= 0`)
- `scope_risk_score` (`0-100`)

### `compliance` (`guardRunnerConfig`)

Optional threshold keys:

- `deadline_critical_days` (`integer >= 0`)
- `deadline_high_days` (`integer >= 0`)
- `payment_term_max_days` (`integer >= 0`)

### `support_ops` (`keeperRunnerConfig`)

Optional threshold keys:

- `renewal_notice_days` (`integer >= 0`)
- `missing_doc_alert_hours` (`integer >= 0`)

### Future Custom `type`

- Any non-built-in `type` uses `genericRunnerConfig` (`runnerConfigBase`) fallback validation.

## Practical Notes

- Most objects enforce `additionalProperties: false`; unknown keys often fail validation.
- Use `type`-appropriate runner config to avoid runtime policy mismatch.
- Keep `toolAllowlist` minimal and explicit for least-privilege operation.
