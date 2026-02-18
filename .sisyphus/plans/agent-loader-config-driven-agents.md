# Plan: Refactor Agents to Loader + Config (Markdown + JSON Schema) with Scheduler-Driven Execution

## TL;DR
> **Quick Summary**: Introduce a config-driven Agent system (loader + registry + runner templates) where each agent is defined by `AGENT.md` + `agent.json` (validated by JSON Schema) and executed by the Scheduler via durable recurring jobs (catch-up safe).
>
> **Deliverables**:
> - Agent config format + JSON Schema + loader (workspace + user config precedence)
> - Agent registry + runner dispatch (starting with `market_listener` + `react_goal`)
> - Durable recurring schedule persistence (`cron_jobs` in SQLite) + claim-due loop
> - Scheduler execution path for agent ticks (template runner engine) + safe policy snapshotting
> - Agent A migrated to config-driven definition (`agents/agent-a/*`) and scheduled via scheduler (no bespoke setInterval loop)

**Estimated Effort**: Large
**Parallel Execution**: YES (5 waves)
**Critical Path**: Agent JSON schema/loader → cron_jobs persistence → agent tick execution engine → Agent A migration → E2E verification

---

## Context

### Original Request
- Refactor agent implementations into a **loader + config file** model.
- Descriptive config prefers **Markdown**; structured config prefers **JSON + JSON Schema**.
- After loading agent config, **execution must happen via scheduler**.

### Confirmed Decisions
- **Scope**: General Agent system (Agent A is first migration, not a one-off).
- **Execution model**: Template-style runner selected by `agent.type`.
- **Config locations**: Both workspace `./agents` and user `~/.ponybunny/agents`.
- **Precedence**: User config overrides workspace config.
- **Scheduling semantics**: Durable catch-up (restart-safe).
- **Schedule format (v1)**: Cron + interval.
- **Catch-up default (v1)**: Coalesce missed runs into a single run.
- **Policy source of truth**: Merge policy into `agent.json` (schema-validated); existing YAML becomes legacy/optional.
- **Runner types (v1)**: Template runner by `agent.type` plus a minimal `react_goal` runner.
- **Tests**: Implement first, then add/adjust tests.

### Relevant Existing Code/Patterns (to follow)
- Skill loader precedence + registry pattern:
  - `src/infra/skills/skill-loader.ts:182` (`loadSkillsWithPrecedence()`)
  - `src/infra/skills/skill-registry.ts:14` (singleton registry)
- Config + AJV schema validation pattern:
  - `src/infra/mcp/config/mcp-config-loader.ts:8`
  - `src/infra/llm/provider-manager/config-loader.ts:189`
- Scheduler daemon current Agent A loop (to replace):
  - `src/scheduler-daemon/daemon.ts:121`
  - `src/scheduler-daemon/agent-a-loop.ts:11`
- Scheduler core execution entry:
  - `src/scheduler/core/scheduler.ts:164`

---

## Work Objectives

### Core Objective
Make Agents first-class, config-driven entities loaded at runtime and executed via Scheduler, starting by migrating Agent A without behavior regressions.

### Concrete Deliverables
- New agent config folder format: `agents/<id>/AGENT.md` + `agents/<id>/agent.json`.
- Agent JSON schema with `schemaVersion` and strict validation.
- `AgentLoader` supporting workspace + user dirs with precedence and caching.
- `AgentRegistry` singleton exposing loaded agents + definition hashes.
- `RunnerRegistry` mapping `agent.type` → runner implementation.
- Durable recurring schedules: `cron_jobs` persistence + due-job claiming + idempotency.
- Scheduler executes agent ticks as work items (cron lane) via:
  - a non-ReAct template runner engine (`market_listener`)
  - a generic ReAct goal runner (`react_goal`)
- Agent A migrated: `agents/agent-a/*` plus runner wiring; remove bespoke `setInterval` path.

### Must Have
- Agent behavior primarily defined in config (schedule, policy, prompts/limits knobs).
- JSON Schema validation with clear errors; invalid configs do not crash daemon.
- Durable scheduling with catch-up limits (no thundering herd on restart).
- Scheduler executes agent ticks and records runs in DB.
- Agent A runs via new system and produces expected storage side effects.

### Must NOT Have (Guardrails)
- No hidden global mutable allowlist that can leak permissions across concurrently executing work.
- No manual verification steps in acceptance criteria.
- No new UI/dashboard scope.
- No deep-merge / inheritance between workspace + user configs in v1 (folder-level override only).
- No file watchers / hot-reload UX in v1 (poll/TTL reload only, if any).

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (Jest under `test/`).
- **Automated tests**: Tests-after (implement core, then add/adjust coverage).

### QA Policy
Every TODO includes agent-executable QA scenarios (commands, DB queries, deterministic assertions). Evidence should be saved under `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves (proposed)

Wave 1 (Foundations: config + schema + interfaces)
Wave 2 (Persistence: cron_jobs + repository + migrations)
Wave 3 (Runtime: loader/registry + reconciliation + claim-due loop)
Wave 4 (Execution: runner registry + agent tick execution engine + scheduler integration)
Wave 5 (Migration + hardening: Agent A config + cutover + E2E verification)

---

## TODOs

- [x] 1. Define `agent.json` contract + JSON Schema (schemaVersion, schedule, policy, runner)

  **What to do**:
  - Define TypeScript types for the structured agent config (what is allowed/required) and the compiled runtime representation.
  - Create an embedded JSON Schema (draft 2020-12) and AJV validator (same style as MCP/LLM config loaders).
  - Include `schemaVersion` from day 1 and reject unknown properties (tighten configs, prevent silent typos).
  - Ensure the schema can represent (at minimum):
    - `id`, `name`, `enabled`
    - `type` (template runner key, e.g. `market_listener`)
    - `schedule` (cron or interval; timezone; catch-up policy fields)
    - `policy` (tool allowlist + forbidden patterns + limits/prompts knobs for the template)

  **Must NOT do**:
  - Do not introduce cron-expression parsing dependency in this task (schema/validation only).
  - Do not bake Agent A specifics into the schema (it must be general).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: cross-cutting type/system boundary design + schema validation.
  - **Skills**: [`backend-developer`]
    - `backend-developer`: schema + validation patterns, TS types.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-6)
  - **Blocks**: Tasks 2, 3, 7+
  - **Blocked By**: None

  **References**:
  - `src/infra/llm/provider-manager/config-loader.ts:189` - AJV + embedded schema validation pattern.
  - `src/infra/mcp/config/mcp-config-loader.ts:31` - embedded schema, env var expansion pattern.
  - `src/infra/skills/skill-loader.ts:182` - precedence loader approach to mirror.

  **Acceptance Criteria**:
  - [ ] `npm run build` passes.
  - [ ] A minimal sample `agents/<id>/agent.json` validates (happy path).
  - [ ] A config with an unknown property fails validation with a clear error message.

  **QA Scenarios**:
  ```
  Scenario: Validate a known-good sample config
    Tool: Bash
    Steps:
      1. Run a small node/tsx script (or jest test) that loads and validates a sample agent.json
      2. Assert validator returns success
    Expected Result: validation PASS
    Evidence: .sisyphus/evidence/task-1-validate-sample.txt

  Scenario: Reject unknown fields
    Tool: Bash
    Steps:
      1. Validate a config that contains an extra key (e.g. "typo_field")
      2. Assert the validator throws/returns invalid with path + message
    Expected Result: validation FAIL with actionable error
    Evidence: .sisyphus/evidence/task-1-validate-unknown-field.txt
  ```

- [x] 2. Implement Agent config discovery + precedence (`./agents` + `~/.ponybunny/agents`)

  **What to do**:
  - Implement directory scanning that discovers agents by folder: `agents/<id>/AGENT.md` + `agents/<id>/agent.json`.
  - Define stable agent identity:
    - Canonical agent id is the folder name `<id>`.
    - Validate `agent.json.id === <id>` (mismatch = invalid config).
  - Support both:
    - workspace agents dir: `<repo>/agents`
    - user agents dir: `<configDir>/agents` where `configDir` follows `PONYBUNNY_CONFIG_DIR` via `src/infra/config/credentials-loader.ts:46`
  - Apply precedence: user overrides workspace **per-agent directory** (no deep merge for v1).
  - Return a list of agent “candidates” with resolved file paths and source (`workspace` vs `user`).
  - Ensure discovery is deterministic:
    - Canonicalize paths for dedupe (avoid symlink duplicates).
    - Do not depend on filesystem iteration order for precedence.

  **Must NOT do**:
  - Do not deep-merge JSON fields across sources in v1 (avoid surprising behavior).
  - Do not require hot-reload watchers in this task; just load-on-demand.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: straightforward file discovery + precedence.
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `src/infra/skills/skill-loader.ts:182` - precedence scanning pattern.
  - `src/infra/config/credentials-loader.ts:46` - config dir resolution with env override.

  **Acceptance Criteria**:
  - [ ] Loader finds workspace agents when `./agents/*` exists.
  - [ ] Loader finds user agents when `~/.ponybunny/agents/*` exists.
  - [ ] If both exist for same `<id>`, user version wins.

  **QA Scenarios**:
  ```
  Scenario: Precedence chooses user config
    Tool: Bash
    Preconditions: Both `./agents/demo/agent.json` and `$PONYBUNNY_CONFIG_DIR/agents/demo/agent.json` exist
    Steps:
      1. Run loader discovery
      2. Assert resolved path/source is user
    Expected Result: user agent selected
    Evidence: .sisyphus/evidence/task-2-precedence-user-wins.txt
  ```

- [x] 3. Build `AgentRegistry` (singleton) with validation, definitionHash, and last-good fallback

  **What to do**:
  - Create a registry that loads all discovered agent candidates, validates `agent.json`, and exposes `getAgent(id)`.
  - Load the descriptive Markdown (`AGENT.md`) and store it as part of the AgentDefinition (raw markdown string is sufficient for v1).
  - Compute a stable `definitionHash` (e.g., sha256 of canonicalized agent.json) for auditability.
  - Maintain a **last-known-good** cache per agent id: if a new config is invalid, keep serving the previous valid definition and emit an escalation/log.
  - Define v1 last-good policy explicitly:
    - If an agent config is invalid but a last-good exists in-memory → continue serving last-good (mark `using_last_good`).
    - If an agent config is invalid and no last-good exists (e.g. invalid at startup) → treat agent as disabled/skipped.
    - Last-good is in-memory only in v1 (restart with invalid config disables until fixed).
  - Provide a `reload()` method with TTL caching (e.g. 5s) instead of file watchers for v1.

  **Must NOT do**:
  - Do not mutate shared global allowlists/tools in the registry.
  - Do not crash daemon on invalid config; degrade gracefully.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 9, 12, 17+
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `src/infra/skills/skill-registry.ts:14` - singleton registry pattern.
  - `src/infra/llm/provider-manager/config-loader.ts:189` - cached load + reload pattern.

  **Acceptance Criteria**:
  - [ ] Registry loads at least one agent definition end-to-end.
  - [ ] Registry exposes `AGENT.md` content for loaded agents.
  - [ ] If config becomes invalid, registry keeps serving last-good definition.
  - [ ] If config is invalid at startup and no last-good exists, the agent is skipped and daemon continues.

  **QA Scenarios**:
  ```
  Scenario: Invalid config does not break registry
    Tool: Bash
    Steps:
      1. Load registry with a valid config (expect success)
      2. Replace config with invalid JSON (expect validation error logged)
      3. Call getAgent(id) again
    Expected Result: returns last-good definition
    Evidence: .sisyphus/evidence/task-3-last-good-fallback.txt
  ```

- [x] 4. Add workspace agent skeleton for Agent A (`agents/agent-a/AGENT.md` + `agents/agent-a/agent.json`)

  **What to do**:
  - Create `agents/agent-a/AGENT.md` describing: purpose, guardrails, schedule intent, and what knobs are configurable.
  - Create `agents/agent-a/agent.json` that matches current Agent A defaults (schedule interval, tick params, policy allowlists, limits/prompts knobs).
  - Ensure `agent.json` includes `$schema` and `schemaVersion`.

  **Must NOT do**:
  - Do not change Agent A behavior yet; config should reflect current defaults.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`writing`]
    - `writing`: clear, concise AGENT.md.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 18+
  - **Blocked By**: Task 1

  **References**:
  - `src/scheduler-daemon/daemon.ts:127` - current hardcoded tick params to mirror in config.
  - `src/app/agents/agent-a/limits.ts:1` - current limits/rate limits to mirror.
  - `src/app/agents/agent-a/prompts.ts:1` - current prompt guardrails to mirror.
  - `src/app/agents/agent-a/tool-allowlist.ts:1` - current MCP allowlist to mirror.

  **Acceptance Criteria**:
  - [ ] `AgentRegistry` loads `agent-a` from workspace and validates successfully.

  **QA Scenarios**:
  ```
  Scenario: Load agent-a definition
    Tool: Bash
    Steps:
      1. Run a script/test that loads registry
      2. Assert agent-a exists, enabled flag read, schedule parsed
    Expected Result: agent-a present and valid
    Evidence: .sisyphus/evidence/task-4-load-agent-a.txt
  ```

- [x] 5. Define runner contract + `RunnerRegistry` (template-style execution)

  **What to do**:
  - Define a runner interface that can execute a single “agent tick” given:
    - `agentId`
    - validated `agent.json` config (or compiled form)
    - a tick context (`now`, `runKey`, optional budget)
  - Implement `RunnerRegistry` mapping `agent.type` → runner instance.
  - Add an explicit error when an enabled agent references an unknown `agent.type`.

  **Must NOT do**:
  - Do not couple runner APIs to Agent A internals (keep it generic).
  - Do not invoke SchedulerCore from runners (keep orchestration outside).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 17, 18
  - **Blocked By**: Task 1

  **References**:
  - `src/scheduler/core/types.ts:188` - scheduler execution engine adapter shape.
  - `src/scheduler-daemon/agent-a-loop.ts:3` - current tick runner concept to generalize.

  **Acceptance Criteria**:
  - [ ] Creating a registry with a `market_listener` runner succeeds.
  - [ ] Attempting to resolve an unknown `agent.type` yields a deterministic error.

  **QA Scenarios**:
  ```
  Scenario: RunnerRegistry resolves a known runner type
    Tool: Bash
    Steps:
      1. Instantiate RunnerRegistry with a stub runner
      2. Resolve runner for agent.type=market_listener
    Expected Result: runner returned
    Evidence: .sisyphus/evidence/task-5-runner-registry-resolve.txt

  Scenario: Unknown runner type is rejected
    Tool: Bash
    Steps:
      1. Attempt resolve for agent.type=unknown_type
      2. Assert error includes agent id + unknown type
    Expected Result: clear error
    Evidence: .sisyphus/evidence/task-5-runner-registry-unknown.txt
  ```

- [x] 6. Define durable scheduling semantics + idempotency strategy (design + types)

  **What to do**:
  - Define the scheduling semantics for v1 (cron + interval, durable persistence):
    - Exactly one of `schedule.cron` or `schedule.everyMs` must be set (no dual schedules in v1).
    - Default misfire/catch-up policy: **coalesce** (when behind, run once then schedule next from now).
    - Cron timezone support: `schedule.tz` (IANA string) optional; if omitted, default to system timezone.
    - Concurrency default: at most 1 in-flight run per agent (no overlapping runs).
    - Configurable safety limits (optional): `maxCatchUpWindowMs`, `maxRunsPerTick`.
  - Define an idempotency key scheme for recurring runs (e.g., `agentId + scheduledForMs`) to prevent duplicate submissions.
  - Produce TS types/constants that will be used by the DB schema + claim logic tasks.

  **Must NOT do**:
  - Do not implement DB schema here.
  - Do not implement cron-expression parsing here (types/semantics only).

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 7-14
  - **Blocked By**: Task 1

  **References**:
  - `src/scheduler/lane-selector/lane-selector.ts:8` - cron lane selection conditions.
  - `src/infra/persistence/schema.sql:49` - existing work_items/goals schema patterns.

  **Acceptance Criteria**:
  - [ ] Semantics are captured as types/constants and referenced by later DB + runtime tasks.

  **QA Scenarios**:
  ```
  Scenario: Misfire policy is documented and testable
    Tool: Bash
    Steps:
      1. Run a unit test for next_run_at calculation under coalesce policy
    Expected Result: deterministic next_run_at behavior
    Evidence: .sisyphus/evidence/task-6-misfire-semantics.txt
  ```

- [x] 7. Add durable `cron_jobs` table to SQLite schema (recurring agent schedules)

  **What to do**:
  - Extend `src/infra/persistence/schema.sql` with a new `cron_jobs` table.
  - Model: one row per agent id (durable schedule state), including:
    - `agent_id` (unique)
    - `enabled`
    - schedule fields (exactly one schedule kind):
      - `schedule_cron` (nullable)
      - `schedule_timezone` (nullable)
      - `schedule_interval_ms` (nullable)
    - `next_run_at_ms`, `last_run_at_ms`
    - in-flight fields to prevent overlapping runs per agent:
      - `in_flight_run_key` (nullable)
      - `in_flight_goal_id` (nullable)
      - `in_flight_started_at_ms` (nullable)
    - claim fields to prevent double-execution: `claimed_at_ms`, `claimed_by`, `claim_expires_at_ms`
    - `definition_hash` (from AgentRegistry) to detect config changes
    - optional backoff fields (`backoff_until_ms`, `failure_count`) to avoid tight retry loops
  - Add `cron_job_runs` table to enforce idempotency across crashes/retries:
    - columns: `run_key` (PK), `agent_id`, `scheduled_for_ms`, `created_at_ms`, `goal_id` (nullable), `status`
    - unique constraint: `(agent_id, scheduled_for_ms)`
  - Add indexes for due-job scans (`enabled`, `next_run_at_ms`) and claim fields.
  - Ensure `npm run build` still copies schema into `dist/infra/persistence/`.

  **Must NOT do**:
  - Do not add a full migrations framework; rely on idempotent `CREATE TABLE IF NOT EXISTS` (new table only).

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Task 6

  **References**:
  - `src/infra/persistence/schema.sql:9` - existing schema patterns.
  - `src/infra/persistence/work-order-repository.ts:24` - schema.sql execution on init.

  **Acceptance Criteria**:
  - [ ] Initializing an empty DB creates `cron_jobs`.
  - [ ] `npm run build` produces `dist/infra/persistence/schema.sql` containing `cron_jobs`.

  **QA Scenarios**:
  ```
  Scenario: cron_jobs table exists after init
    Tool: Bash
    Steps:
      1. Run a script that calls WorkOrderDatabase.initialize() against a temp db
      2. Query sqlite_master for cron_jobs
    Expected Result: cron_jobs present
    Evidence: .sisyphus/evidence/task-7-cron-jobs-table.txt
  ```

- [x] 8. Add cron job persistence APIs to repository (upsert, claim-due, backoff)

  **What to do**:
  - Extend `src/infra/persistence/repository-interface.ts:3` with cron job operations needed by the daemon:
    - upsert job for an agent (enabled + schedule (cron/interval) + definition_hash)
    - list/claim due jobs (atomically, with claim TTL), excluding jobs that are currently in-flight
    - update job after submission/run outcome (set/clear in-flight fields; last_run, next_run, failure/backoff)
    - idempotency helpers for `cron_job_runs`:
      - insert-or-ignore run record by `(agent_id, scheduled_for_ms)` and return `run_key`
      - link `run_key` → `goal_id` after submission
      - update run status on completion/failure
  - Implement methods in `src/infra/persistence/work-order-repository.ts:16` using better-sqlite3.
  - Ensure claim-due is safe against multiple daemon instances (UPDATE with WHERE guard + check affected rows).

  **Must NOT do**:
  - Do not allow a claim-due method that can return the same job to two instances.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 14, 22, 23
  - **Blocked By**: Task 7

  **References**:
  - `src/infra/persistence/repository-interface.ts:3` - current repository contract.
  - `src/infra/persistence/work-order-repository.ts:24` - initialize + exec schema.

  **Acceptance Criteria**:
  - [ ] A due job can be claimed once; a second claim attempt fails until claim expires.
  - [ ] Backoff fields prevent immediate re-claim until `backoff_until_ms`.
  - [ ] Inserting the same `(agent_id, scheduled_for_ms)` twice results in exactly one `cron_job_runs` row.

  **QA Scenarios**:
  ```
  Scenario: Claim due job is exclusive
    Tool: Bash
    Steps:
      1. Insert a cron_job due now
      2. Call claimDueJobs(instance=A)
      3. Call claimDueJobs(instance=B) immediately
    Expected Result: only A receives the job
    Evidence: .sisyphus/evidence/task-8-claim-exclusive.txt
  ```

- [ ] 9. Reconcile AgentRegistry ↔ cron_jobs (create/update/disable rows)

  **What to do**:
  - On daemon startup (and periodically), reconcile loaded agent definitions with `cron_jobs`:
    - enabled agent → upsert cron job (schedule + enabled + definition_hash)
    - disabled agent → disable cron job
    - missing agent (previously existed) → disable or delete cron job row
  - Ensure reconciliation respects user override precedence (AgentRegistry is already resolved).
  - Ensure invalid agent configs do not break reconciliation: skip and create escalation/log.

  **Must NOT do**:
  - Do not delete cron job history needed for audit unless explicitly chosen.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 3, 8

  **References**:
  - `src/scheduler-daemon/daemon.ts:74` - daemon startup lifecycle.
  - `src/infra/persistence/work-order-repository.ts:116` - goal creation patterns (used later).

  **Acceptance Criteria**:
  - [ ] Enabling/disabling an agent in config updates cron_jobs accordingly.

  **QA Scenarios**:
  ```
  Scenario: Reconciliation upserts and disables cron_jobs
    Tool: Bash
    Steps:
      1. Load registry with two agents: one enabled, one disabled
      2. Run reconciliation
      3. Query cron_jobs rows
    Expected Result: enabled job enabled=1, disabled job enabled=0
    Evidence: .sisyphus/evidence/task-9-reconcile-cron-jobs.txt
  ```

- [ ] 10. Add scheduler-daemon PID lock (prevent multiple daemon instances)

  **What to do**:
  - Implement a PID lock file guard in SchedulerDaemon startup.
  - Place lock under the config dir (respects `PONYBUNNY_CONFIG_DIR`) or alongside `dbPath`.
  - On start:
    - if lock exists and PID is alive → refuse to start
    - if lock exists but PID is stale → replace lock
  - On stop: remove lock.

  **Must NOT do**:
  - Do not hardcode paths outside config/db (keep it testable).

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14 (prevents multi-instance claim races)
  - **Blocked By**: None

  **References**:
  - `src/scheduler-daemon/daemon.ts:74` - daemon lifecycle.
  - `src/infra/config/credentials-loader.ts:46` - config dir.

  **Acceptance Criteria**:
  - [ ] Starting daemon twice causes second start to fail fast with a clear error.
  - [ ] Stale lock is recovered.

  **QA Scenarios**:
  ```
  Scenario: Second daemon instance is rejected
    Tool: Bash
    Steps:
      1. Start daemon (foreground)
      2. Attempt to start a second daemon pointing at same config/db
    Expected Result: second start exits non-zero with message referencing lock
    Evidence: .sisyphus/evidence/task-10-pid-lock-reject.txt
  ```

- [ ] 11. Fix scheduler factory work-item listing (use `getWorkItemsByGoal`, not ready-only)

  **What to do**:
  - Update `src/gateway/integration/scheduler-factory.ts:71` so WorkItemManager sees all work items for a goal.
  - This prevents incorrect goal completion and enables future queued/blocked workflows.
  - Ensure queued items can actually execute once full listing is enabled:
    - Update `src/scheduler/work-item-manager/work-item-manager.ts:45` to transition `queued` → `ready` in the repository when dependencies are satisfied (before returning it as ready).
    - Add/adjust unit tests so a queued, no-deps work item becomes ready and can transition to `in_progress` without throwing.

  **Must NOT do**:
  - Do not expand scope to redesign statuses; keep it a targeted correctness fix.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 14, 22, 23 (integration relies on correct listing)
  - **Blocked By**: None

  **References**:
  - `src/gateway/integration/scheduler-factory.ts:70` - current ready-only mapping.
  - `src/infra/persistence/repository-interface.ts:16` - `getWorkItemsByGoal` exists.
  - `src/scheduler/work-item-manager/work-item-manager.ts:45` - ready/queued logic to make transition-safe.

  **Acceptance Criteria**:
  - [ ] WorkItemManager.areAllWorkItemsComplete() returns false when a goal has non-done work items.
  - [ ] A queued work item with no dependencies is transitioned to `ready` before execution (no invalid transition errors).

  **QA Scenarios**:
  ```
  Scenario: Goal with queued work items is not considered complete
    Tool: Bash
    Steps:
      1. Create a goal + work item in DB (status queued)
      2. Call areAllWorkItemsComplete(goalId)
    Expected Result: returns false
    Evidence: .sisyphus/evidence/task-11-workitem-listing.txt
  ```

- [ ] 12. Implement cron expression parsing + timezone handling (library adapter + tests)

  **What to do**:
  - Add a small cron parsing dependency (e.g. `cron-parser`) and wrap it behind a tiny adapter so the rest of the codebase is not coupled to the library.
  - Define a minimal cron contract for v1:
    - 5-field cron (`min hour dom month dow`) only (no seconds).
    - Optional `tz` (IANA timezone string). If omitted, default to system timezone.
  - Expose helper(s):
    - validate cron string (return actionable errors)
    - compute next fire time after a given `fromMs`
  - Add golden tests including at least one DST boundary case for a named timezone (e.g. `America/Los_Angeles`).

  **Must NOT do**:
  - No cron “extras” (exclusions, jitter, calendars) in v1.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 13-15)
  - **Blocks**: Task 13, 14
  - **Blocked By**: Task 1

  **References**:
  - `src/scheduler-daemon/daemon.ts:80` - daemon is the integration point for schedule processing.

  **Acceptance Criteria**:
  - [ ] Cron parsing rejects invalid expressions with a clear error.
  - [ ] Next-fire calculation is deterministic for a fixed `fromMs` and `tz`.
  - [ ] DST golden test passes.

  **QA Scenarios**:
  ```
  Scenario: Validate and compute next cron fire
    Tool: Bash
    Steps:
      1. Run a unit test for cron adapter (valid + invalid cases)
    Expected Result: tests PASS
    Evidence: .sisyphus/evidence/task-12-cron-adapter.txt
  ```

- [ ] 13. Implement schedule computation (cron + interval) with coalesce misfire policy

  **What to do**:
  - Implement pure logic that computes:
    - whether a job is due at `nowMs`
    - `scheduled_for_ms` (idempotency key input)
    - `next_run_at_ms` after dispatch under **coalesce** policy
  - Support both schedule kinds:
    - interval: `everyMs`
    - cron: `cron` (+ optional `tz`, using Task 12 adapter)
  - Ensure the function reports how many firings were coalesced (for logs/telemetry), but still emits only one dispatch.

  **Must NOT do**:
  - Do not touch DB schema here.
  - Do not add retries/backoff policy beyond what already exists in `cron_jobs` fields.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 6, 12

  **References**:
  - `src/scheduler-daemon/agent-a-loop.ts:38` - existing “no overlap” semantics to preserve (inFlight guard).

  **Acceptance Criteria**:
  - [ ] Interval schedule produces `scheduled_for_ms` and `next_run_at_ms` correctly.
  - [ ] Cron schedule produces `scheduled_for_ms` and `next_run_at_ms` correctly.
  - [ ] Coalesce: when behind by N firings, exactly 1 dispatch is produced and `coalesced_count=N` is reported.

  **QA Scenarios**:
  ```
  Scenario: Coalesce missed firings
    Tool: Bash
    Steps:
      1. Run unit tests for schedule computation with nowMs far beyond last_run
      2. Assert dispatchCount=1 and coalescedCount=N
    Expected Result: tests PASS
    Evidence: .sisyphus/evidence/task-13-coalesce.txt
  ```

- [ ] 14. Add AgentScheduler dispatch loop to SchedulerDaemon (claim due jobs → create goals/work items → submit)

  **What to do**:
  - Add a new daemon-side component (e.g. `AgentScheduler`) that:
    - Loads AgentRegistry (resolved precedence) and reconciles definitions → `cron_jobs` (Task 9)
    - Periodically claims due jobs (Task 8)
    - For each claimed job:
      - Compute `(scheduled_for_ms, next_run_at_ms, coalesced_count)` via Task 13
      - Insert-or-ignore `cron_job_runs` for idempotency (Task 8)
      - Create a scheduler Goal + WorkItem representing this run
      - Ensure the created WorkItem is set to `ready` (queued → ready) before scheduler processes it
      - Call `scheduler.submitGoal(goal)` to execute via SchedulerCore
      - Update `cron_jobs` schedule state + link `cron_job_runs.goal_id`
  - Subscribe to scheduler events (`goal_completed` / `goal_failed`) to update `cron_job_runs.status` and clear any in-flight markers.

  **Must NOT do**:
  - No filesystem watchers; use simple polling/TTL reload.
  - No distributed multi-host coordination; only single-host multi-process lease safety.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (integration)
  - **Blocks**: Tasks 15-23
  - **Blocked By**: Tasks 3, 8, 9, 10, 13

  **References**:
  - `src/scheduler-daemon/daemon.ts:80` - daemon startup lifecycle.
  - `src/scheduler/core/scheduler.ts:164` - `submitGoal()` entrypoint.
  - `src/infra/persistence/work-order-repository.ts:116` - goal creation patterns.
  - `src/infra/persistence/work-order-repository.ts:227` - work item creation patterns (includes context field).
  - `src/scheduler/types.ts:150` - scheduler event types to subscribe to.

  **Acceptance Criteria**:
  - [ ] A due cron job results in exactly 1 new Goal + WorkItem being created and submitted.
  - [ ] Idempotency: the same `(agent_id, scheduled_for_ms)` cannot create two runs/goals.
  - [ ] On restart while behind, only 1 coalesced dispatch occurs.

  **QA Scenarios**:
  ```
  Scenario: Dispatch one due job
    Tool: Bash
    Steps:
      1. Start daemon with a test agent enabled and a schedule due immediately
      2. Wait for one dispatch cycle
      3. Query DB: cron_job_runs has 1 row and a non-null goal_id
    Expected Result: exactly one dispatch
    Evidence: .sisyphus/evidence/task-14-dispatch-once.txt
  ```

- [ ] 15. Add template-runner execution path for agent tick work items (RunnerRegistry dispatch)

  **What to do**:
  - Define a work-item context contract for template-runner execution (e.g. `context.kind = "agent_tick"`) including:
    - `agent_id`, `definition_hash`, `run_key`, `scheduled_for_ms`, `policy_snapshot`
  - Implement an execution engine that, for `agent_tick` work items:
    - Loads the current AgentDefinition from AgentRegistry (by `agent_id`)
    - Verifies `definition_hash` matches (or logs mismatch) and uses the embedded snapshot when present
    - Resolves runner via RunnerRegistry and executes one tick
    - Returns a deterministic success/failure to SchedulerCore
  - Integrate this into scheduler execution by extending `src/gateway/integration/execution-engine-adapter.ts:43`:
    - If work item is `agent_tick` → execute via template runner engine
    - Else → fall back to existing `ExecutionService.executeWorkItem()`

  **Must NOT do**:
  - Do not break existing ReAct execution behavior for normal work items.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-18)
  - **Blocks**: Task 19+
  - **Blocked By**: Tasks 5, 14

  **References**:
  - `src/gateway/integration/execution-engine-adapter.ts:43` - current execution adapter.
  - `src/gateway/integration/scheduler-factory.ts:56` - where execution engine adapter is constructed.
  - `src/scheduler/core/types.ts:188` - execution engine adapter interface.

  **Acceptance Criteria**:
  - [ ] A work item with `context.kind="agent_tick"` executes the template runner path.
  - [ ] A normal work item still executes via `ExecutionService`.

  **QA Scenarios**:
  ```
  Scenario: agent_tick work item routes to template runner
    Tool: Bash
    Steps:
      1. Create a work item with context.kind=agent_tick and a stub runner
      2. Run scheduler tick loop once
    Expected Result: stub runner invoked and work item completes
    Evidence: .sisyphus/evidence/task-15-agent-tick-routing.txt
  ```

- [ ] 16. Implement `market_listener` template runner (Agent A) behind RunnerRegistry

  **What to do**:
  - Implement the first real template runner: `agent.type = "market_listener"`.
  - Runner executes one tick by calling the existing Agent A service (no behavior changes):
    - Derive the tick input from `agent.json` (max_sources_per_tick, max_items_per_source, default_time_window, etc.).
    - Ensure “no overlap” semantics are enforced at the scheduling layer (Task 13/14) and/or inside runner.
  - Move Agent A’s hardcoded knobs into config-driven fields (without changing defaults).

  **Must NOT do**:
  - Do not change Agent A pipeline semantics; only parameterize via config.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 15, 17, 18)
  - **Blocks**: Task 20
  - **Blocked By**: Tasks 4, 5, 15

  **References**:
  - `src/app/agents/agent-a/agent-a-service.ts:99` - current tick pipeline (must remain unchanged).
  - `src/scheduler-daemon/daemon.ts:121` - current Agent A tick input defaults to mirror into config.
  - `src/app/agents/agent-a/limits.ts:1` - current limits to mirror.

  **Acceptance Criteria**:
  - [ ] Running a single `market_listener` tick via scheduler work item succeeds (happy path).
  - [ ] Default values in `agents/agent-a/agent.json` match the current hardcoded defaults.

  **QA Scenarios**:
  ```
  Scenario: Run one market_listener tick
    Tool: Bash
    Steps:
      1. Enable agent-a in config with a very long interval (or manual trigger)
      2. Trigger one due run and let scheduler execute it
    Expected Result: run completes and cron_job_runs is marked success
    Evidence: .sisyphus/evidence/task-16-agent-a-tick.txt
  ```

- [ ] 17. Add `react_goal` agent type (config → scheduler Goal/WorkItem submission)

  **What to do**:
  - Extend `agent.json` schema to support `agent.type = "react_goal"` with a minimal config payload:
    - goal title + description template
    - optional budgets (tokens/time/cost)
    - optional model hint (if supported)
    - per-agent tool allowlist (list of tool names)
  - In AgentScheduler (Task 14), when due and `agent.type==react_goal`:
    - Create a normal scheduler Goal + WorkItem whose description is the goal prompt
    - Attach allowlist into WorkItem context so execution is scoped (Task 18)
    - Submit via `scheduler.submitGoal(goal)`

  **Must NOT do**:
  - Do not invent a new planning/execution lifecycle; reuse existing Scheduler + ExecutionService.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 22
  - **Blocked By**: Tasks 1, 14

  **References**:
  - `src/scheduler/core/scheduler.ts:164` - scheduler submission.
  - `src/infra/persistence/repository-interface.ts:35` - goal creation contract.
  - `src/infra/persistence/repository-interface.ts:50` - work item creation contract.

  **Acceptance Criteria**:
  - [ ] A `react_goal` agent due run creates a Goal + WorkItem and is submitted.
  - [ ] Work item carries tool allowlist in context (visible in DB).

  **QA Scenarios**:
  ```
  Scenario: react_goal agent dispatch
    Tool: Bash
    Steps:
      1. Add a demo react_goal agent config with schedule due immediately
      2. Start daemon; wait for dispatch
      3. Query DB: work_item.context includes tool allowlist
    Expected Result: goal/work item created with scoped context
    Evidence: .sisyphus/evidence/task-17-react-goal-dispatch.txt
  ```

- [ ] 18. Enforce per-work-item tool allowlist for ReAct execution (no global mutation)

  **What to do**:
  - Add support for an optional per-work-item allowlist (e.g. `workItem.context.tool_allowlist: string[]`).
  - Update ExecutionService/ReActIntegration wiring so tool enforcement uses the per-work-item allowlist when present:
    - Create a per-run ToolAllowlist + ToolEnforcer that wraps the existing ToolRegistry (no global allowlist mutation).
    - Ensure two concurrent runs with different allowlists do not leak permissions.
  - Add tests:
    - one work item with allowlist that excludes an MCP tool → tool call denied
    - another work item concurrently allows it → tool call allowed

  **Must NOT do**:
  - Do not use `setGlobalToolProvider()` or mutate shared singletons per run.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 22
  - **Blocked By**: Task 14

  **References**:
  - `src/app/lifecycle/execution/execution-service.ts:32` - current global ToolAllowlist/ToolEnforcer.
  - `src/autonomy/react-integration.ts:438` - tool invocation enforcement point.
  - `src/infra/tools/tool-registry.ts:51` - ToolAllowlist/ToolEnforcer types.

  **Acceptance Criteria**:
  - [ ] A disallowed tool invocation is denied when the work item specifies a restrictive allowlist.
  - [ ] No cross-run leakage under concurrent execution.

  **QA Scenarios**:
  ```
  Scenario: Per-work-item allowlist blocks tool
    Tool: Bash
    Steps:
      1. Run a unit/integration test that executes a work item which attempts a disallowed tool
      2. Assert result contains "Action denied" and run completes safely
    Expected Result: denied deterministically
    Evidence: .sisyphus/evidence/task-18-allowlist-scoping.txt
  ```

- [ ] 19. Wire AgentScheduler into daemon lifecycle + add CLI flag to enable config-driven agents

  **What to do**:
  - Add a new SchedulerDaemon config flag (e.g. `agentsEnabled`) and CLI option (e.g. `pb scheduler start --agents`).
  - On daemon start:
    - If `agentsEnabled`, construct and start AgentScheduler (Task 14).
    - Ensure AgentRegistry loads from both `./agents` and `~/.ponybunny/agents` with correct precedence.
  - On daemon stop: stop AgentScheduler loop cleanly.
  - Keep `--agent-a` temporarily for backward compatibility, but mark as deprecated in help text.

  **Must NOT do**:
  - Do not enable any agent by default; agent enablement is controlled by `agent.json.enabled`.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 20-23)
  - **Blocks**: Task 23
  - **Blocked By**: Task 14

  **References**:
  - `src/cli/commands/scheduler-daemon.ts:288` - CLI options/wiring.
  - `src/scheduler-daemon/daemon.ts:80` - daemon lifecycle.

  **Acceptance Criteria**:
  - [ ] `pb scheduler start --foreground --agents` starts with agents scheduling enabled (log line).
  - [ ] With no enabled agents, no cron jobs are dispatched.

  **QA Scenarios**:
  ```
  Scenario: Daemon starts with --agents
    Tool: Bash
    Steps:
      1. Start `pb scheduler start --foreground --agents`
      2. Observe logs for "AgentScheduler enabled" (or equivalent)
    Expected Result: agent scheduler loop running
    Evidence: .sisyphus/evidence/task-19-daemon-agents-flag.txt
  ```

- [ ] 20. Cut over Agent A: remove bespoke setInterval loop and rely on config-driven scheduling

  **What to do**:
  - Remove (or permanently disable) the bespoke `AgentATickRunner` wiring in `src/scheduler-daemon/daemon.ts:121`.
  - Ensure Agent A runs only when `agents/agent-a/agent.json` is enabled and scheduled.
  - Keep the existing Agent A implementation under `src/app/agents/agent-a/` for now; only change how it is triggered.
  - Update CLI help/docs to point users to `agents/agent-a/agent.json` enable/schedule knobs.

  **Must NOT do**:
  - Do not change Agent A’s internal pipeline logic.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: Task 23
  - **Blocked By**: Tasks 16, 19

  **References**:
  - `src/scheduler-daemon/daemon.ts:121` - current setInterval loop.
  - `src/scheduler-daemon/agent-a-loop.ts:11` - loop implementation to remove from critical path.

  **Acceptance Criteria**:
  - [ ] `--agent-a` no longer changes runtime behavior (or is removed).
  - [ ] Agent A runs only via `cron_jobs` scheduling.

  **QA Scenarios**:
  ```
  Scenario: Agent A runs via cron_jobs, not setInterval
    Tool: Bash
    Steps:
      1. Enable agent-a in `agents/agent-a/agent.json`
      2. Start daemon with `--agents` (without `--agent-a`)
      3. Query DB: cron_job_runs rows appear for agent-a
    Expected Result: agent-a scheduled runs recorded
    Evidence: .sisyphus/evidence/task-20-agent-a-cutover.txt
  ```

- [ ] 21. Add non-UI diagnostics for agent scheduling (logs + config status)

  **What to do**:
  - Add structured log lines (or debug events) for:
    - discovered agents + their source (workspace vs user)
    - validation failures (schema path + message)
    - precedence decisions (when user overrides workspace)
    - dispatch decisions (due, coalesced_count, idempotency-skip)
  - Expose a minimal “config status” concept in logs: `valid | invalid | using_last_good`.

  **Must NOT do**:
  - No new UI; no watchers.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Tasks 3, 14

  **References**:
  - `src/scheduler-daemon/daemon.ts:103` - scheduler event forwarding (potential hook for agent events).

  **Acceptance Criteria**:
  - [ ] Starting daemon prints agent discovery + validation status.
  - [ ] A coalesced dispatch logs `coalesced_count`.

  **QA Scenarios**:
  ```
  Scenario: Invalid config is logged and does not crash
    Tool: Bash
    Steps:
      1. Create an invalid agent.json
      2. Start daemon with --agents
    Expected Result: daemon stays up; logs include validation error
    Evidence: .sisyphus/evidence/task-21-invalid-config-logs.txt
  ```

- [ ] 22. Add integration tests for durable scheduling (idempotency, coalesce, multi-daemon claim)

  **What to do**:
  - Add Jest tests that use a temp sqlite DB and exercise:
    - due scan + claim exclusivity (Task 8)
    - cron_job_runs idempotency constraint
    - coalesce misfire behavior (Task 13)
    - multi-daemon contention: two schedulers pointing at same DB → only one dispatch per scheduled_for_ms

  **Must NOT do**:
  - Do not require external services (no Docker) for these tests; keep them fast and deterministic.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: Task 23
  - **Blocked By**: Tasks 7, 8, 13, 14

  **References**:
  - `test/` - existing Jest test patterns.
  - `src/infra/persistence/work-order-repository.ts:24` - DB init path.

  **Acceptance Criteria**:
  - [ ] `npx jest` passes including new scheduling test suite.

  **QA Scenarios**:
  ```
  Scenario: Run scheduling integration tests
    Tool: Bash
    Steps:
      1. Run `npx jest test/scheduler/agent-scheduling.test.ts`
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-22-tests.txt
  ```

- [ ] 23. End-to-end verification runbook (agent-executable) for scheduled agents

  **What to do**:
  - Add an agent-executable E2E script (tsx or Jest) that:
    - Starts the scheduler daemon in-process (or constructs SchedulerDaemon directly)
    - Enables a demo agent (react_goal) with a schedule due immediately
    - Waits for exactly one dispatch
    - Asserts DB state: goal/work item created, run record completed, cron_job_runs marked
  - Save evidence outputs under `.sisyphus/evidence/final-qa/`.

  **Must NOT do**:
  - No manual steps.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`backend-developer`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 5 (final integration)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Tasks 19, 20, 22

  **References**:
  - `src/cli/commands/scheduler-daemon.ts:112` - daemon construction flow.

  **Acceptance Criteria**:
  - [ ] E2E script passes on a clean checkout.
  - [ ] Evidence files exist under `.sisyphus/evidence/final-qa/`.

  **QA Scenarios**:
  ```
  Scenario: Run scheduled agent E2E
    Tool: Bash
    Steps:
      1. Run `npx tsx test/e2e-agent-scheduling.ts`
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-23-e2e.txt
  ```

---

## Final Verification Wave

- [ ] F1. Plan compliance audit (oracle)
- [ ] F2. Code quality review (unspecified-high)
- [ ] F3. End-to-end QA runbook execution (unspecified-high)
- [ ] F4. Scope fidelity check (deep)

---

## Commit Strategy

- Prefer small, atomic commits per wave (schema/loader, DB persistence, scheduler integration, Agent A migration).

---

## Success Criteria

### Verification Commands (examples)
```bash
# Unit tests
npx jest

# Run scheduler daemon with agents enabled (exact command depends on CLI flags added in this refactor)
pb scheduler start --foreground --agents
```

### Final Checklist
- [ ] Agent configs load from both workspace and user dir with user override precedence.
- [ ] Invalid agent config fails validation but does not crash daemon; last-good config remains usable.
- [ ] Durable cron jobs persist and execute after daemon restart (within catch-up policy).
- [ ] Agent A runs via scheduler-driven agent tick and produces expected stored outputs.
