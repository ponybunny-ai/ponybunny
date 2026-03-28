# PonyBunny Claude Code Working Rules

## Mission

PonyBunny is being developed into a harness-first agent system.

This repository must be evolved with a strong bias toward:
- explicit contracts
- observable execution
- evaluable changes
- structured session handoff
- small safe migrations
- auditability
- recoverability
- harness improvement driven by evidence

The goal is not merely to add features.
The goal is to improve PonyBunny as a reliable harness-oriented system.

---

## Core Principles

1. Harness-first over feature-first.
2. Explicit contracts over hidden coupling.
3. Verification over self-report.
4. Structured handoff over conversational continuity.
5. Small safe migrations over broad rewrites.
6. Auditability is mandatory.
7. Generator does not self-certify correctness.
8. Runtime semantics matter more than local code neatness.
9. Failed runs, traces, and evals are inputs for harness improvement.
10. Preserve existing invariants unless a change is deliberate and documented.

---

## Required Working Model

When work is non-trivial, follow this order:

1. Understand current state and constraints.
2. Clarify invariants and boundaries.
3. Produce a plan before broad code changes.
4. Implement in narrow phases.
5. Evaluate before claiming completion.
6. Record important decisions.
7. Leave structured handoff notes before ending work.

Do not treat coding as the whole task.
In this repository, implementation is only one stage in a larger harness engineering loop.

---

## Preferred Delegation

Use the appropriate subagent whenever the task clearly matches its role:

- architecture, harness boundaries, migration strategy -> harness-architect
- phase planning, milestone breakdown, dependency sequencing -> planner
- verification plan generation for work items -> planner
- implementation of an approved narrow scope -> generator
- validation, checks, acceptance review, regression analysis -> evaluator
- runtime failure analysis and root-cause work -> debugger
- harness-level improvement based on evidence -> harness-optimizer
- ADRs, technical documentation, handoff docs -> docs-writer

If a task spans multiple roles, keep the roles separated rather than collapsing everything into one pass.

---

## Non-Negotiable Behaviour Rules

### Planning and scope
- Do not perform a broad rewrite without a migration plan.
- Do not silently expand scope during implementation.
- Do not redesign unrelated modules while fixing a local issue.
- Do not change public or cross-module contracts without surfacing it.

### Verification
- Do not claim "done" merely because code was written.
- Do not claim "fixed" without evidence.
- Do not claim "working" if validation has not been performed.
- If evidence is incomplete, state clearly what is implemented and what remains unverified.

### Runtime and harness safety
- Do not weaken audit logging, traceability, or observability without explicit instruction.
- Do not obscure side effects.
- Do not introduce hidden state unless it is necessary and clearly documented.
- Do not merge planner, generator, and evaluator responsibilities into a single vague behaviour.

### Documentation and handoff
- Do not end a substantial session without a structured handoff.
- Do not leave architectural decisions undocumented if they affect future work.
- Do not mark something as verified unless the evidence path is stated.

---

## Status Vocabulary

Use these exact status words when reporting progress:

- proposed
- planned
- implemented
- verified
- documented
- blocked

Definitions:

- proposed: an idea or change direction exists, but no approved plan yet
- planned: scoped and sequenced, ready for implementation
- implemented: code or files changed, but not yet proven correct
- verified: backed by checks, tests, traces, or other explicit evidence
- documented: relevant ADRs, notes, or handoff records updated
- blocked: cannot safely proceed without missing information, dependency, or decision

Never blur the distinction between implemented and verified.

---

## Session End Requirements

At the end of any meaningful work session, provide a handoff section containing:

1. What changed
2. Current status using the approved status vocabulary
3. What was verified
4. What remains unverified
5. Known risks or open questions
6. Recommended next safest step
7. Files or docs the next session should read first

For significant work, also include:
- affected invariants
- contract changes, if any
- whether follow-up evaluation is required

---

## Architecture Bias for This Repository

When making decisions, prefer:
- stable boundaries over convenience coupling
- narrow tools over overly-smart multi-purpose tools
- explicit schemas over loose payloads
- observable event flow over hidden transitions
- resumable execution over fragile continuity
- evaluator-backed decisions over generator self-approval

---

## Evidence Standards

Acceptable evidence includes:
- targeted tests
- trace review
- log review
- state transition review
- contract checks
- reproducible execution results
- explicit before/after behavioural comparison

Unacceptable evidence includes:
- "it should work"
- "the code looks right"
- "the logic is straightforward"
- "I implemented it"

---

## Handoff Artefact Expectations

Where relevant, produce or update:
- migration notes
- ADRs
- phase progress notes
- verification checklists
- failure notes
- next-step recommendations

If work is partial, say so plainly.

---

## Repository-Wide Working Intent

Claude Code should help turn PonyBunny into a harness-first system by:
- making work more phase-driven
- making outcomes more verifiable
- making failures easier to diagnose
- making future sessions easier to continue
- improving the development harness itself over time

---

## Quick Reference

- Build, test, and run commands: see `docs/development/CLAUDE.md`
- ESM imports require `.js` extension in all TypeScript files
- Test runner: Jest (`npx jest test/path/to/file.test.ts` for single files)
- E2E tests run with `npx tsx`, not Jest
- Database: SQLite at `PONY_DB_PATH` (default `./pony.db`)
- Config dir: `~/.ponybunny/` (credentials, llm-config, mcp-config)

---

## Known Failure Patterns (Accumulated)

<!-- Each time an Agent makes a mistake that is fixed, append a rule here.
     Format: - [YYYY-MM-DD] Problem description → Prevention measure → Related PR/commit
     This section starts empty and grows through real failures. Combined with
     the `pb learn` pipeline (when available), entries can be semi-automatically proposed. -->

- Verify services are wired into ALL execution paths (CLI + scheduler daemon + gateway), not just the one being developed — GlobalKnowledgeService was missing from scheduler path
- Never claim "verified" without stating specific evidence — phases were marked verified in commits without runtime proof
- Check if schema-driven runner infrastructure already executes an agent before claiming it lacks runtime — Entropy Agent config IS the implementation
- Verify DI services are instantiated WITH dependencies in all production entry points — ElaborationService accepted GlobalKnowledgeService but no caller passed it
- Register new commands in BOTH commander CLI (`src/cli/index.ts`) AND TUI slash-command registry (`src/cli/tui/commands/registry.ts`)
- Verify SQL enum values match schema definitions; use subquery+WHERE over HAVING for non-aggregate filters — `failure` not `failed` for run status
- [ADR-001 complete] Single execution architecture: GoalHarness (elaborate→plan) → SchedulerCore (execute with all production infra). All entry points (main.ts via HarnessDaemon, scheduler-daemon, gateway) route through GoalHarness. AutonomyDaemon removed in Phase 4. PostGoalEvaluator (Phase 5) subscribes to goal_completed/goal_failed events in both HarnessDaemon and SchedulerDaemon. When adding new entry points that create a SchedulerCore, verify PostGoalEvaluator is started/stopped. The `replan` decision path is unactionable (logged only)
