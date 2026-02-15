# Plan: Implement Agent A (agent_a_market_listener) in PonyBunny

## TL;DR

Implement the Agent A spec from `docs/agents/agent-a.md:1` inside PonyBunny by (1) splitting the spec into runtime-loadable per-skill `skills/agent-a/*` docs, (2) enforcing the spec’s MCP server naming + tool allowlist, (3) adding an Agent A-specific system prompt for its LLM subcalls, and (4) wiring a long-running Agent A tick loop into the scheduler daemon behind an explicit `pb scheduler start --agent-a` flag. Verification is TDD + required docker E2E (real MCP + Postgres).

**Deliverables**
- Per-skill docs: `skills/agent-a/*/SKILL.md`
- Machine-readable policy: `docs/agents/agent-a.orchestrator-policy.yaml`
- Scheduler flag + Agent A runner integration
- Required unit tests + required docker E2E test

**Estimated Effort**: Medium
**Parallel Execution**: YES (docs + some tests in parallel after core blockers)
**Critical Path**: Fix MCP server-name mismatch -> scheduler integration -> docker E2E green

---

## Context

### Original Request (User)
- Implement Agent A as described in `docs/agents/agent-a.md:1` within PonyBunny.
- Prefer doc/config/system-prompt changes first (including splitting into skills docs); only enhance code when needed.
- Minimize architecture changes unless required.

### Key Decisions (Confirmed)
- Skills docs: split per skill (A0/A1/A2...) and store under `skills/agent-a/*` (runtime-loaded).
- Run mode: scheduler job, enabled by explicit flag on scheduler start (default off).
- System prompt language: English.
- Test strategy: TDD.
- Verification: require docker E2E with real MCP + Postgres.
- MCP server names: `playwright` / `reddit` / `github` / `pg`.

### Current Repo State (Observed)
- Agent A code exists under `src/app/agents/agent-a/` and implements the strict pipeline order in `src/app/agents/agent-a/agent-a-service.ts:99`.
- MCP tool allowlist and storage currently use server name `postgres` (mismatch vs desired `pg`): `src/app/agents/agent-a/tool-allowlist.ts:13`, `src/app/agents/agent-a/storage.ts:177`.
- Scheduler daemon exists and has a tick loop for work-order goals, but no built-in recurring job scheduler: `src/scheduler-daemon/daemon.ts:67`.
- Skills are loadable from `skills/*/SKILL.md`: `src/infra/skills/skill-loader.ts:100`.
- MCP config respects `PONYBUNNY_CONFIG_DIR` via `getConfigDir()`; E2E tests can isolate config: `src/infra/config/credentials-loader.ts:46`.

---

## Work Objectives

### Core Objective
Ship a production-safe, local-first Agent A that runs unattended (looping), respects strict tool allowlists + guardrails, persists checkpoints/dedupe/observations to Postgres via MCP, and is verifiable via unit + docker E2E tests.

### Must Have
- Strict pipeline order preserved (control.tick -> source.read_stream -> detect -> extract -> role -> store) per `docs/agents/agent-a.md:43`.
- Tool allowlist enforced for MCP calls; forbidden tool patterns blocked per `docs/agents/agent-a.md:80`.
- MCP server naming matches spec: `pg` not `postgres`.
- Skill docs present and loadable by PonyBunny skill loader.
- Scheduler integration runs Agent A loop when explicitly enabled.
- Required docker E2E demonstrates one tick produces DB writes.

### Must NOT Have (Guardrails)
- No posting/reply/DM or “create/update/delete” operations on external platforms (per `docs/agents/agent-a.md:10`).
- No arbitrary OS command execution by Agent A.
- No Agent B logic (commercial decisions/advice).
- No scope creep: no UI/dashboard, no new MCP servers.

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (Jest is already used under `test/`).
- **Automated tests**: TDD.
- **E2E**: Required docker E2E using real MCP + Postgres.

### Agent-Executable Verification Only
All acceptance criteria in TODOs must be runnable by the executor via commands (Jest, tsx scripts, docker compose, psql/curl). No manual verification.

---

## Execution Strategy

### Parallel Waves

Wave 1 (blockers):
- Task 1 (server name mismatch + tests)
- Task 2 (poll interval enforcement + tests)

Wave 2 (docs/policy/prompt):
- Task 3 (system prompt integration + tests)
- Task 4 (split per-skill docs + load verification)
- Task 5 (orchestrator policy yaml + schema validation tests)

Wave 3 (runtime integration + E2E):
- Task 6 (scheduler flag + Agent A loop integration + tests)
- Task 7 (docker compose + E2E script + E2E assertions)

---

## TODOs

### 1) Fix MCP server-name mismatch (`postgres` -> `pg`) and keep allowlist strict

**What to do (TDD)**
1. RED: Add/adjust unit tests to assert Agent A uses serverName `pg` consistently.
2. GREEN: Update allowlist + storage to use `pg` serverName (and optionally support `postgres` as backward-compat if you want, but spec is `pg`).
3. REFACTOR: Ensure error messages remain clear.

**References**
- `docs/agents/agent-a.md:31` (required MCP endpoints)
- `docs/agents/agent-a.md:89` (MCP tools and naming intent)
- `src/app/agents/agent-a/tool-allowlist.ts:13` (current MCP allowlist keyed by `postgres`)
- `src/app/agents/agent-a/storage.ts:177` (current serverName usage)
- `src/app/agents/agent-a/mcp-tool-executor.ts:10` (central enforcement point)

**Acceptance Criteria (agent-runnable)**
- `npx jest test/app/agents/agent-a/tool-allowlist.test.ts` passes.
- `npx jest test/app/agents/agent-a/storage.test.ts` passes.
- No remaining `postgres` serverName literals in Agent A code except explicitly-supported compatibility paths.

---

### 2) Enforce `poll_interval_seconds` selection in `control.tick`

**What to do (TDD)**
1. RED: Add unit tests for skip logic: a source is skipped if last run (or checkpoint updated_at) is newer than now - poll_interval_seconds.
2. GREEN: Implement the skip in `AgentAService.shouldSkipSource()`.
3. REFACTOR: Keep strict pipeline order unchanged.

**References**
- `docs/agents/agent-a.md:125` (A0 policy: source selection, rate limiting, checkpointing)
- `src/app/agents/agent-a/types.ts:21` (`poll_interval_seconds` exists)
- `src/app/agents/agent-a/agent-a-service.ts:170` (skip logic hook)
- `src/app/agents/agent-a/storage.ts:83` (source query includes `poll_interval_seconds`)

**Acceptance Criteria**
- `npx jest test/app/agents/agent-a/agent-a-service.test.ts` includes poll-interval tests and passes.

---

### 3) Provide an Agent A-specific system prompt for LLM subcalls (detect/extract/role)

**What to do (TDD)**
1. RED: Add tests to assert prompts include hard guardrails (mute, no advice, JSON-only) and schema constraints.
2. GREEN: Introduce a single source of truth for Agent A prompts (e.g. `src/app/agents/agent-a/prompts.ts`) and wire `src/app/agents/agent-a/llm-helpers.ts:43` to use them.
3. REFACTOR: Keep token budgets conservative.

**Notes**
- This is a “doc/config/prompt first” requirement; it is also the smallest way to enforce guardrails on model behavior.

**References**
- `docs/agents/agent-a.md:10` (hard guardrails)
- `docs/agents/agent-a.md:121` (skills format + failure modes expectation)
- `src/app/agents/agent-a/llm-helpers.ts:43` (current ad-hoc prompts)
- `src/infra/llm/llm-service.ts:400` (`completeForAgent` for agent-specific routing)

**Acceptance Criteria**
- `npx jest test/app/agents/agent-a/llm-helpers.test.ts` asserts prompt contains: "Return ONLY valid JSON", "verbatim only", and the mute/no-advice constraints.

---

### 4) Split `docs/agents/agent-a.md` into per-skill runtime-loadable skills docs

**What to do (docs + verification)**
Create six skills under `skills/agent-a/` (one directory per skill), each with `SKILL.md` frontmatter + sections: Intent, Inputs, Outputs, Tools, Policy, Failure Modes.

Skills to create:
- A0 `control.tick`
- A1 `source.read_stream`
- A2 `text.detect_problem_signal`
- A3 `text.extract_problem_block`
- A4 `analysis.guess_author_role`
- A5 `data.store_record`

**References**
- `docs/agents/agent-a.md:125` (A0 section)
- `docs/agents/agent-a.md:175` (A1 section)
- `docs/agents/agent-a.md:80` (tool allowlist)
- `src/infra/skills/skill-loader.ts:100` (skill discovery contract: directory + `SKILL.md`)
- `src/cli/commands/skills.ts:104` (CLI listing behavior)

**Acceptance Criteria**
- `pb skills list --source workspace` shows the six Agent A skills (agent executes this in a shell).
- A unit test (or lightweight ts test) verifies all six directories exist and each `SKILL.md` contains valid frontmatter with `name` + `description`.

---

### 5) Add `agent-a.orchestrator-policy.yaml` (machine-readable policy)

**What to do**
Create `docs/agents/agent-a.orchestrator-policy.yaml` encoding:
- Tool allowlist: MCP server names + tool names
- Forbidden patterns (post/reply/create/update/delete)
- Rate limits/backoff thresholds (from `src/app/agents/agent-a/limits.ts` and/or spec)
- Circuit breaker config

Also add a test to ensure the YAML stays in sync with runtime constants (at least tool allowlist + server names + thresholds).

**References**
- `docs/agents/agent-a.md:561` (requested artifacts)
- `src/app/agents/agent-a/limits.ts:1` (rate limits + caps)
- `src/app/agents/agent-a/tool-allowlist.ts:13` (allowlist source)

**Acceptance Criteria**
- `npx jest test/app/agents/agent-a/orchestrator-policy.test.ts` passes (new test): parses YAML and asserts it contains required keys and matches runtime allowlist.

---

### 6) Wire Agent A loop into Scheduler Daemon behind `pb scheduler start --agent-a`

**What to do (TDD)**
1. RED: Add unit test(s) ensuring `--agent-a` flag is parsed and passed into daemon config.
2. GREEN: Implement `--agent-a` in `src/cli/commands/scheduler-daemon.ts:111` and plumb through to `src/scheduler-daemon/daemon.ts:19` config.
3. GREEN: In `src/scheduler-daemon/daemon.ts:67`, when enabled, start a background loop that:
   - initializes Agent A (MCP integration already initialized in scheduler startup)
   - calls `AgentAService.tick()` on a fixed interval (configurable)
   - respects `poll_interval_seconds` and existing backoff/circuit breaker
   - logs minimal metrics and failures
   - stops cleanly when scheduler daemon stops

**Integration Constraints**
- Avoid refactoring scheduler core unless absolutely necessary.
- The loop must not block scheduler goal execution.

**References**
- `src/cli/commands/scheduler-daemon.ts:171` (MCP initialization happens here)
- `src/scheduler-daemon/daemon.ts:67` (daemon lifecycle)
- `src/app/agents/agent-a/agent-a-service.ts:99` (tick entry point)

**Acceptance Criteria**
- `pb scheduler start --foreground --agent-a` starts without crashing and logs Agent A start message.
- `pb scheduler stop` stops and loop terminates (no hanging process).
- Jest tests for flag parsing and daemon lifecycle integration pass.

---

### 7) Required docker E2E: real MCP + Postgres + one Agent A tick

**What to do**
1. Add a docker compose file for Agent A’s required services (Postgres DB + Playwright MCP + Reddit MCP + GitHub MCP + Postgres MCP) matching the spec URLs in `docs/agents/agent-a.md:31`.
2. Add an E2E test script (prefer `test/e2e/agent-a.e2e.ts`) that:
   - sets `PONYBUNNY_CONFIG_DIR` to a workspace temp dir
   - writes a minimal `mcp-config.json` in that dir with server names `playwright/reddit/github/pg`
   - brings up docker compose
   - starts a tiny local HTTP server (inside the test script) that serves a deterministic HTML page containing an obvious “problem signal” and verbatim text to extract
   - seeds `agent_a_sources` with **forum_web** pointing at that local URL (avoid relying on Reddit/GitHub credentials for E2E)
   - runs one tick by calling `AgentAService.tick()` directly (preferred for determinism)
   - asserts DB has: schema tables, a run row, and >=1 observation row with `platform='forum_web'` and `permalink` equal to the seeded URL

**References**
- `docs/agents/agent-a.md:29` (topology + endpoints)
- `docs/agents/agent-a.md:520` (seed SQL)
- `src/infra/mcp/config/mcp-config-loader.ts:17` (config path resolution)
- `src/infra/config/credentials-loader.ts:46` (`PONYBUNNY_CONFIG_DIR`)
- `src/app/agents/agent-a/source-reader.ts:198` (forum_web path uses Playwright MCP)

**Acceptance Criteria**
- `docker compose -f docker-compose.agent-a.yml up -d` succeeds.
- `PONYBUNNY_CONFIG_DIR=./.tmp/agent-a-config npx tsx test/e2e/agent-a.e2e.ts` exits 0.
- The E2E script asserts: `select count(*) from agent_a_observations where platform='forum_web'` is >= 1.

---

## Success Criteria

### Verification Commands
```bash
# Unit + integration
npx jest test/app/agents/agent-a/

# E2E
docker compose -f docker-compose.agent-a.yml up -d
PONYBUNNY_CONFIG_DIR=./.tmp/agent-a-config npx tsx test/e2e/agent-a.e2e.ts
```

### Final Checklist
- [ ] Agent A tool allowlist uses server name `pg` as spec requires.
- [ ] Agent A respects poll intervals per source.
- [ ] Agent A LLM calls use a dedicated English system prompt with hard guardrails.
- [ ] Six per-skill docs exist and are loadable via `pb skills list --source workspace`.
- [ ] Scheduler daemon can run Agent A loop when `--agent-a` is set.
- [ ] Docker E2E passes and demonstrates DB writes.
