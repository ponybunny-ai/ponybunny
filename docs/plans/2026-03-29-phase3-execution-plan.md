# Phase 3 Execution Plan

**Status**: planned
**Date**: 2026-03-29
**Prerequisite**: Phase 1+2 verified (1954 tests, 234 suites)
**Scope**: Gap 5.A, Gap 4.D, Gap 6.C, Gap 3.C, plus architecture quality immediate wins

---

## Summary

Phase 3 contains four gap items and three architecture quality quick-wins. After source analysis, the work decomposes into six ordered sub-phases. The architecture quick-wins (Sub-phase 0) come first because they are zero-risk, zero-dependency, and reduce confusion for all subsequent work. The `--review-plan` feature (Sub-phase 1) is highest value because it affects the GoalHarness contract. Entropy Agent (Sub-phase 2) is config-only. Web UI Dashboard (Sub-phases 3-4) depends on understanding the evaluation data surface. Playwright MCP (Sub-phase 5) is optional and self-contained.

---

## Assumptions

1. The existing `pb work --plan-first` in `src/cli/commands/work.ts` is the CLI-direct path. The new `--review-plan` applies to the daemon/RPC path via GoalHarness, not the CLI-direct path.
2. `DaemonEventEmitterMixin` in `src/autonomy/daemon-event-emitter.ts` is actively used by gateway integration code (6 production import sites). It cannot be deleted outright -- it must be relocated alongside `react-integration.ts`.
3. The HarnessDaemon `maxConcurrentGoals: 2` and SchedulerConfig `maxConcurrentGoals: 5` serve different purposes (planning concurrency vs execution concurrency). The fix is documentation + single-source configuration, not necessarily making them equal.
4. `pb webui start/stop/status/logs` is already implemented. The Web UI Harness Dashboard (Gap 6.C) refers to a **page within the Next.js app**, not the CLI commands.
5. Existing test suites (1954 tests) must continue to pass after each sub-phase.

---

## Sub-phase 0: Architecture Quality Quick-Wins

### Objective
Eliminate structural confusion from ADR-001 remnants before feature work begins.

### Why it matters now
Three items create daily confusion: a dead-named directory (`src/autonomy/`), a possible dead file (`daemon-event-emitter.ts` that is actually alive), and an undocumented concurrent-goals mismatch. Fixing these first prevents Phase 3 feature work from building on misleading structure.

### Dependencies
None.

### Tasks

**Task 0.1: Relocate `react-integration.ts` from `src/autonomy/` to `src/runtime/react/`**

- Create `src/runtime/react/` directory
- Move `src/autonomy/react-integration.ts` to `src/runtime/react/react-integration.ts`
- Update all import paths (3 production files + tests):
  - `src/runtime/execution-boundary/local-execution-cycle-runner.ts`
  - `src/cli/ui/chat-ui.tsx`
  - `src/compatibility.ts`
- Update any tests that import from the old path
- Verification: `npx jest` passes all 1954+ tests. `grep -r "autonomy/react-integration" src/` returns zero hits.

**Task 0.2: Relocate `daemon-event-emitter.ts` from `src/autonomy/` to `src/runtime/events/`**

- IMPORTANT: This file is NOT dead. It has 6+ production import sites across gateway integration code.
- Create `src/runtime/events/` directory
- Move `src/autonomy/daemon-event-emitter.ts` to `src/runtime/events/daemon-event-emitter.ts`
- Update all import paths:
  - `src/gateway/integration/gateway-daemon-lifecycle.ts`
  - `src/gateway/integration/gateway-daemon-attachment.ts`
  - `src/gateway/integration/daemon-event-forwarding.ts`
  - `src/gateway/integration/daemon-compatibility.ts`
  - `src/gateway/gateway-server.ts`
  - `src/compatibility.ts`
- Update 8 test files that import from the old path
- Remove empty `src/autonomy/` directory
- Verification: `npx jest` passes all tests. `ls src/autonomy/` fails (directory gone). All gateway integration tests pass.

**Task 0.3: Unify concurrent goal limits with documentation**

- In `src/infra/config/runtime-config.ts`, add a second config key: `scheduler.maxConcurrentPlanning` (default 2), distinct from existing `scheduler.maxConcurrentGoals` (default 5)
- Update `src/main.ts` line 164 to read from `runtimeConfig.scheduler.maxConcurrentPlanning` instead of hardcoded 2
- Update `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` similarly
- Add inline documentation explaining: "maxConcurrentPlanning limits how many goals GoalHarness processes concurrently (elaborate + plan). maxConcurrentGoals limits how many goals SchedulerCore executes concurrently. Planning is cheaper than execution, but the planning limit must be <= execution limit."
- Verification: `npx jest` passes. Both values are now sourced from runtime config with clear names and documentation.

### Constraints
- No runtime behavior change -- these are structural moves and config naming only
- `src/compatibility.ts` re-export paths must be updated to preserve backward compat for any external consumers

### Acceptance Criteria
- `src/autonomy/` directory no longer exists
- All imports reference new locations
- Concurrent goal limits have distinct, documented config keys
- All 1954+ tests pass
- No new warnings or errors in `npx tsc --noEmit`

### Handoff
- Updated file locations documented for subsequent sub-phases
- Any test file path changes noted

---

## Sub-phase 1: `pb work --review-plan` Plan Approval Mode (Gap 5.A)

### Objective
Add a plan-review gate to the daemon/RPC execution path where GoalHarness pauses after planning and waits for user approval before delegating to SchedulerCore.

### Why it matters now
This is the highest-value Phase 3 item. It implements human-in-the-loop for the production execution path (HarnessDaemon), not just the CLI-direct path. The existing `--plan-first` only works in the `pb work` CLI command. The new `--review-plan` works through the harness/RPC path.

### Dependencies
- Sub-phase 0 complete (clean directory structure)

### Constraints
- GoalHarness invariant: "GoalHarness NEVER performs execution" -- must be preserved
- GoalHarness is stateless -- the pause state must be persisted in the Goal record, not in GoalHarness memory
- PostGoalEvaluator must not be affected

### Tasks

**Task 1.1: Design the plan-review state machine extension**

This is a design task, not implementation.

- Define a new Goal status: `plan_review` (between `queued` and `active`)
- Define the state transitions: `queued -> elaborating -> plan_review -> active` (on approve) or `plan_review -> cancelled` (on reject)
- Define where `plan_review` fits in the existing status enum
- Document whether `plan_review` is opt-in (per-goal flag) or global (HarnessDaemon config)
- Output: A short design document or ADR addendum specifying the exact state machine, config surface, and RPC methods
- Verification: Design reviewed by architect role before implementation

**Task 1.2: Add `plan_review` Goal status and persistence**

- Add `plan_review` to the Goal status enum/type in `src/work-order/types/`
- Add the status to any SQL CHECK constraints on the `goals` table
- Ensure `getGoalsByStatus('plan_review')` works in the repository
- Verification: Unit test that creates a goal, transitions it to `plan_review`, and queries it back

**Task 1.3: Modify GoalHarness to support plan review pause**

- Add optional `reviewMode` flag to `GoalSubmission` and `GoalHarnessDependencies`
- In `elaboratePlanDelegate()`, after step 4 (planning), if reviewMode is enabled:
  - Set goal status to `plan_review` instead of `active`
  - Store the planned WorkItem IDs in goal context
  - Return `GoalHarnessResult` with `delegatedToScheduler: false` and a new field `awaitingPlanReview: true`
  - Do NOT call `schedulerCore.submitGoal()`
- Verification: Unit test that shows GoalHarness stops at `plan_review` when reviewMode is set

**Task 1.4: Add `plan.approve` and `plan.reject` RPC handlers**

- New file: `src/gateway/rpc/handlers/plan-review-handlers.ts`
- `plan.approve { goalId }`: transitions goal from `plan_review` to `active`, delegates to SchedulerCore
- `plan.reject { goalId, reason? }`: transitions goal from `plan_review` to `cancelled`
- `plan.get { goalId }`: returns the planned WorkItem DAG for a goal in `plan_review` status
- Register handlers in `src/gateway/rpc/handler-registry.ts` (or equivalent)
- Verification: Integration test that submits a goal with review mode, calls `plan.get`, then `plan.approve`, verifies goal transitions to active

**Task 1.5: Add `--review-plan` flag to `pb work` CLI command**

- Add `--review-plan` option (distinct from existing `--plan-first`)
- When used, the CLI:
  1. Submits goal via RPC with `reviewMode: true`
  2. Polls or subscribes for `plan_review` status
  3. Calls `plan.get` to display the WorkItem DAG
  4. Prompts user for y/N
  5. Calls `plan.approve` or `plan.reject`
- Verification: Manual end-to-end test with running gateway+scheduler daemon

**Task 1.6: Update HarnessDaemon to respect review mode configuration**

- Add `reviewMode` to `HarnessDaemonConfig`
- When `reviewMode: true`, HarnessDaemon passes it through to GoalHarness
- When a goal is in `plan_review`, HarnessDaemon skips it in the polling loop (does not count against `maxConcurrentPlanning`)
- Verification: Unit test showing HarnessDaemon correctly skips `plan_review` goals

### Acceptance Criteria
- Goals can be created with review mode enabled
- GoalHarness pauses at `plan_review` after planning, does not delegate
- RPC methods `plan.approve`, `plan.reject`, `plan.get` work
- CLI `pb work --review-plan <task>` shows plan and waits for approval
- Rejected goals are cancelled, approved goals proceed to execution
- All existing tests pass (no regression)
- New tests cover the plan review state machine

### Handoff
- New goal status `plan_review` added to schema -- any future work touching goal statuses must account for it
- RPC handler pattern established in `plan-review-handlers.ts` for reference
- HarnessDaemon config surface expanded

---

## Sub-phase 2: Entropy Agent Weekly Cron (Gap 4.D)

### Objective
Configure a weekly cron agent that detects documentation/code drift.

### Why it matters now
Low effort (config only), prevents drift accumulation. No code changes to core modules.

### Dependencies
- None (can run in parallel with Sub-phase 1 if desired)

### Constraints
- Must use existing Cron Agent infrastructure in `config/personas/`
- Must not introduce new runtime dependencies
- Agent should create Escalations for detected drift, not auto-fix

### Tasks

**Task 2.1: Create entropy-checker persona config**

- New file: `config/personas/entropy-checker.json`
- Fields: `agent_id`, `name`, `schedule` (cron: `0 3 * * 1` -- Monday 3 AM), `task` (describe consistency checks), `policy` (tool allowlist, token/cost limits)
- Consistency checks to include:
  1. CLAUDE.md sub-agent roles vs `skills/` directory
  2. `docs/reverse-engineering/` API list vs `src/gateway/rpc/handlers/` actual files
  3. Config schema docs vs `src/infra/config/` implementation
- Verification: JSON validates. Config matches the persona schema used by existing `pony-default.json`.

**Task 2.2: Verify cron infrastructure loads the new persona**

- Confirm that the cron scheduler reads from `config/personas/` and registers agents
- If discovery is manual (requires registration), add the entropy-checker to the registry
- Verification: Start scheduler daemon, confirm log shows entropy-checker registered (or document that registration is automatic)

### Acceptance Criteria
- `config/personas/entropy-checker.json` exists and is valid
- Cron infrastructure recognizes the agent
- Agent task description covers the three consistency checks
- No code changes to core modules

### Handoff
- Document how to verify the agent ran (check escalations table, check logs)

---

## Sub-phase 3: Web UI Harness Dashboard Data Layer (Gap 6.C prerequisite)

### Objective
Build the data aggregation queries that power the cross-goal failure clustering dashboard, independent of the UI.

### Why it matters now
The dashboard UI (Sub-phase 4) needs data. Separating the data layer allows independent verification and reuse by CLI tools.

### Dependencies
- Sub-phase 0 complete (evaluation reports table exists from Phase 1+2)

### Constraints
- Queries must run against SQLite only (no external DB)
- Must work with existing schema tables: `runs`, `goals`, `work_items`, `goal_evaluation_reports`, `global_knowledge`
- Must be usable from both the Web UI API routes and the `pb dashboard` CLI command

### Tasks

**Task 3.1: Create harness metrics aggregation service**

- New file: `src/app/observability/harness-metrics-service.ts` (or extend existing)
- Methods:
  - `getErrorSignatureClusters(limit?: number)`: Top N error_signature values with counts, most recent occurrence, affected goals
  - `getWorkItemTypeFailureRates()`: Failure rate per `item_type`
  - `getGoalSuccessTimeline(days: number)`: Daily goal completion/failure counts
  - `getEvaluationDecisionDistribution()`: Aggregate publish/retry/replan/escalate from `goal_evaluation_reports`
  - `getKnowledgeEffectiveness()`: Count of knowledge entries by type, avg confidence, recently reinforced
- All methods are pure SQL queries, no LLM calls
- Verification: Unit tests with seeded SQLite data, asserting correct aggregation results

**Task 3.2: Expose metrics via RPC**

- New handler file: `src/gateway/rpc/handlers/harness-metrics-handlers.ts`
- RPC methods:
  - `harness.errorClusters { limit? }` -> cluster data
  - `harness.failureRates {}` -> item_type failure rates
  - `harness.timeline { days? }` -> daily success/failure counts
  - `harness.evaluationDistribution {}` -> decision distribution
- Verification: Integration test calling each RPC and validating response shape

### Acceptance Criteria
- All five aggregation queries work correctly
- RPC handlers registered and accessible
- Unit tests cover edge cases (empty DB, single goal, many goals)
- No changes to existing tables or schemas

### Handoff
- RPC method names and response shapes documented for Web UI team
- SQL queries available for reuse in `pb dashboard` CLI

---

## Sub-phase 4: Web UI Harness Dashboard Page (Gap 6.C)

### Objective
Build the dashboard page in the Next.js web app showing cross-goal failure patterns, evaluation distributions, and knowledge base health.

### Why it matters now
This is the user-facing deliverable for observability. It depends on Sub-phase 3 data layer.

### Dependencies
- Sub-phase 3 (data aggregation service + RPC handlers)

### Constraints
- Must work within existing `web/` Next.js 16 + React 19 + Tailwind 4 + shadcn/ui stack
- Must connect to Gateway via WebSocket (existing pattern in web app)
- Dashboard is read-only -- no mutations

### Tasks

**Task 4.1: Create dashboard page route**

- New page: `web/app/dashboard/page.tsx`
- Layout: 4-panel grid
  - Top-left: Error signature clusters (table, sorted by count desc)
  - Top-right: Goal success/failure timeline (line chart or simple table, last 30 days)
  - Bottom-left: Evaluation decision distribution (pie/bar chart or counts)
  - Bottom-right: Knowledge base summary (counts by type, avg confidence)

**Task 4.2: Create RPC client hooks**

- Hooks that call Gateway WebSocket RPC for each `harness.*` method
- Follow existing hook patterns in `web/`
- Handle loading/error states

**Task 4.3: Create dashboard UI components**

- Error cluster table component
- Timeline component (can be simple table initially, chart later)
- Decision distribution component
- Knowledge summary component
- Use shadcn/ui components for consistency

**Task 4.4: Add navigation link**

- Add "Harness Dashboard" link to existing navigation/sidebar in web app

### Acceptance Criteria
- Dashboard page renders at `/dashboard`
- All four panels show data from the RPC layer
- Page handles empty state gracefully (no data yet)
- No regressions in existing web app pages
- Manual verification: start web UI, navigate to dashboard, see data (or empty state)

### Verification approach
- This is a UI deliverable. Verification is manual visual inspection.
- If Playwright MCP is available (Sub-phase 5), automated screenshot verification can be added later.

### Handoff
- Dashboard page URL and component locations documented
- Note any shadcn/ui components that were added

---

## Sub-phase 5: Playwright MCP for Browser Verification (Gap 3.C) -- Optional

### Objective
Configure Playwright MCP as an optional verification tool for UI-producing work items.

### Why it matters now
Low priority, but straightforward config-only work. Unblocks future UI verification automation.

### Dependencies
- None (independent of other sub-phases)

### Constraints
- Must be disabled by default
- Must use Layer 2 (approval required) for all Playwright tools
- Must not add Playwright as a production dependency

### Tasks

**Task 5.1: Add Playwright MCP config entry**

- Add to `~/.ponybunny/mcp-config.json` (or the template/example):
  ```json
  {
    "playwright": {
      "enabled": false,
      "transport": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "allowedTools": ["browser_navigate", "browser_screenshot", "browser_click", "browser_evaluate"],
      "layer": 2
    }
  }
  ```
- Verification: Config parses without error. When disabled, no Playwright process spawned.

**Task 5.2: Document Playwright MCP usage**

- Add section to `docs/development/CLAUDE.md` or a new doc explaining:
  - How to enable Playwright MCP
  - What tools are available
  - Example usage in a verification_plan quality gate
- Verification: Documentation exists and is accurate

### Acceptance Criteria
- MCP config entry exists, disabled by default
- No production dependencies added
- Enabling it spawns Playwright MCP process
- Documentation complete

---

## Execution Order and Parallelism

```
Sub-phase 0 (quick-wins)         ----[2-3 hours]---->
Sub-phase 1 (--review-plan)      --------[3-5 days]--------->
Sub-phase 2 (entropy agent)      --[1-2 hours]-->   (parallel with 1)
Sub-phase 3 (dashboard data)     ------[2-3 days]------>   (after 0, parallel with 1)
Sub-phase 4 (dashboard UI)       ------[3-5 days]-------->   (after 3)
Sub-phase 5 (playwright)         --[1-2 hours]-->   (parallel with anything)
```

Sub-phases 2 and 5 are independent and can run at any time.
Sub-phase 3 can start after Sub-phase 0, in parallel with Sub-phase 1.
Sub-phase 4 requires Sub-phase 3.
Sub-phase 1 is the most complex and should start early.

---

## Verification Checklist

| Sub-phase | Verification Method | Evidence Required |
|-----------|-------------------|-------------------|
| 0 | `npx jest` all pass, `npx tsc --noEmit` clean, `ls src/autonomy/` fails | Test count >= 1954, zero compile errors |
| 1 | New unit + integration tests for plan_review state machine | Tests pass, manual CLI walkthrough documented |
| 2 | JSON schema validation, daemon log showing registration | Config valid, log excerpt |
| 3 | Unit tests with seeded DB for all 5 aggregation methods | Tests pass with correct counts |
| 4 | Manual visual inspection of dashboard page | Screenshot or description of each panel |
| 5 | Config parse test, enable/disable toggle works | Config loads without error |

---

## Risk Register

| Risk | Sub-phase | Mitigation |
|------|-----------|------------|
| `daemon-event-emitter.ts` relocation breaks gateway | 0 | Full test suite run; 8 test files also need path updates |
| `plan_review` status breaks existing goal state machine assumptions | 1 | Task 1.1 is design-first; check all `goal.status` comparisons in codebase |
| GoalHarness statelessness violated by review mode | 1 | State stored in Goal DB record, not GoalHarness memory |
| Entropy agent cron infrastructure may not auto-discover personas | 2 | Task 2.2 explicitly checks this |
| Dashboard SQL queries slow on large datasets | 3 | Add LIMIT clauses, indices already exist on key columns |
| Web UI stack version mismatch (Next.js 16 RC?) | 4 | Use existing web/ patterns, do not upgrade dependencies |

---

## Files to Read First (for implementers)

**Sub-phase 0:**
- `/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/autonomy/daemon-event-emitter.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/compatibility.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/main.ts` (lines 120-170)

**Sub-phase 1:**
- `/Users/nickma/Develop/nick-ma/pony/src/harness/goal-harness.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/harness/goal-harness-interface.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/harness/harness-daemon.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/cli/commands/work.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/gateway/rpc/handlers/goal-handlers.ts`

**Sub-phase 2:**
- `/Users/nickma/Develop/nick-ma/pony/config/personas/pony-default.json`

**Sub-phase 3:**
- `/Users/nickma/Develop/nick-ma/pony/src/harness/post-goal-evaluator.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/cli/commands/failure-analysis.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/cli/commands/dashboard.ts`
- `/Users/nickma/Develop/nick-ma/pony/src/gateway/rpc/handlers/evaluation-handlers.ts`

**Sub-phase 4:**
- `/Users/nickma/Develop/nick-ma/pony/web/` (app router structure)

**Sub-phase 5:**
- `~/.ponybunny/mcp-config.json` (if it exists)
