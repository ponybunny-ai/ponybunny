# Learnings

- Keep this file append-only.
- Switched Agent A MCP serverName from `postgres` to `pg` to match spec; updated allowlist and storage call sites + tests.
- Enforced per-source `poll_interval_seconds` by skipping when checkpoint `updated_at` is too recent; added unit test.
- Centralized Agent A LLM system prompts with guardrails in `prompts.ts` and added prompt coverage tests.
- Added per-skill SKILL.md files under `skills/agent-a/*` with required sections and a test to verify their presence.
- Added machine-readable orchestrator policy YAML and a sync test against runtime allowlist/limits.
- Added Agent A tick runner and scheduler flag `--agent-a` to start the loop; added CLI help test.
