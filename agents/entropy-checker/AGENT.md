# Entropy Checker Agent

Periodic consistency checker that detects drift between documentation, configuration, and code implementation.

## Purpose

As PonyBunny evolves, documentation, schemas, agent configs, and code can drift apart. The Entropy Checker runs on a weekly cron schedule to detect these inconsistencies before they cause runtime failures or mislead developers.

This agent implements the "Entropy Agent" concept from the harness gap analysis (docs/plans/2026-03-28-harness-gap-analysis.md, Gap 4.C).

## Consistency Dimensions

1. **CLAUDE.md roles vs skill files** — Each sub-agent role in CLAUDE.md should have a corresponding skill definition in `.claude/commands/`.
2. **Reverse engineering docs vs RPC handlers** — API descriptions in `docs/reverse-engineering/` should match actual `src/gateway/rpc/` implementations.
3. **JSON schemas vs config types** — Schema definitions in `docs/schemas/` should match runtime configuration structures in `src/infra/config/`.
4. **Agent config validity** — All enabled agents in `agents/` should have valid `agent.json` configs that pass schema validation.
5. **Failure patterns freshness** — References in CLAUDE.md's Known Failure Patterns section should still point to existing files/functions.

## Schedule

- **Cron**: `0 3 * * 1` (3:00 AM every Monday, Europe/London)
- **Catch-up**: Coalesce missed runs (max 1 replay)
- **Jitter**: Up to 60 seconds

## Constraints

- **Read-only**: No file writes, command execution, or web access
- **Budget**: 30,000 tokens max, $0.80 cost cap
- **Scope**: Scans up to 200 files per run

## Output

Produces a JSON array of inconsistency reports, each containing:
- `dimension`: which check category found the issue
- `severity`: low / medium / high
- `description`: what is inconsistent
- `location`: file paths involved
- `recommendation`: suggested fix

High-severity findings trigger an Escalation (type: ambiguous, severity: low) for human review.

## Related

- Gap analysis: docs/plans/2026-03-28-harness-gap-analysis.md (Gap 4.C)
- Cron infrastructure: src/infra/scheduler/cron-job-reconciler.ts
- Agent registry: src/infra/agents/agent-registry.ts
