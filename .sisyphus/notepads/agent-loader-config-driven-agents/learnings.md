- Added AJV-based agent config validation mirroring existing credential/MCP patterns, with clearer paths for required/additionalProperties errors.
- Agent schedule schema enforces exactly one of cron or everyMs and rejects unknown fields.
- Agent discovery now resolves workspace and user agent directories with deterministic ordering and realpath-based dedupe.
- AgentRegistry now caches validated agent definitions with deterministic hashes and last-good fallback when configs become invalid.
- Agent A defaults (schedule, prompts, limits, rate limits, and tick inputs) are now captured in workspace agent.json for config-driven loading.
- Added runner contract + RunnerRegistry mapping agent.type to runner with tick context carrying now/runKey and optional budget.
- Added scheduling semantics module with coalesce interval helper, idempotency key helper, and default catch-up/concurrency constants for durable scheduling.
- Added cron_jobs/cron_job_runs schema with schedule constraint plus due/claim/run lookup indexes.
- Cron jobs are now enforced as one row per agent via primary key on agent_id.
- Added cron job repository methods for upsert, claim with leases, backoff-aware selection, and cron run idempotency.
- WorkOrderDatabase schema load now resolves from module URL (with dist fallback) to avoid cwd dependence in tests and runtime.
- Cron job reconciliation now upserts registry agents and disables missing cron_jobs rows via repository APIs.

- Scheduler daemon now uses a PID lock in the config directory to prevent multiple instances and replace stale locks.

- WorkItemManager now promotes queued items with satisfied dependencies to ready before scheduling to avoid invalid transitions.

- Cron adapter uses cron-parser with explicit 5-field enforcement and IANA timezone validation via Intl.DateTimeFormat.

- Added schedule computation for cron/interval schedules to compute due status, scheduled_for_ms, next_run_at_ms, and coalesced_count under coalesce policy.
- AgentScheduler dispatch flow claims due cron jobs, uses cron run idempotency, and tracks in-flight run metadata to update cron run/job status on goal completion.

- AgentScheduler now branches on `agent.config.type` so `react_goal` dispatch creates ExecutionService-oriented work-item context (`tool_allowlist`, optional `model`) while leaving non-`react_goal` `agent_tick` context unchanged.
- `react_goal` dispatch maps runner budget config (`tokens`, `time_minutes`, `cost_usd`) directly into Goal budget fields (`budget_tokens`, `budget_time_minutes`, `budget_cost_usd`).

- Task 18: Per-work-item `context.tool_allowlist` is now enforced via run-scoped `ToolAllowlist`/`ToolEnforcer` passed into ReAct execution, preventing cross-run permission leakage while preserving default behavior when no override exists.

- Task 19: Added `--agents` flag to `pb scheduler start`, forwarded it through background spawn, and wired `agentsEnabled` into `SchedulerDaemon` so AgentScheduler loop/interval initialization runs only when explicitly enabled.
- Task 19: Kept `--agent-a` for compatibility and marked it as deprecated in CLI help text; agent config (`agent.json.enabled`) remains the source of agent-level enablement once scheduler feature is turned on.

- Task 19 unblock: `WorkOrderDatabase.initialize()` now resolves schema paths from `dirname(fileURLToPath(import.meta.url))` directly, removing script-eval/`__filename` fallback and preserving dist-first schema selection.
- Bounded foreground probe with `--agents` now reaches daemon startup (`AgentScheduler loop enabled` and startup success) confirming the runtime blocker was fixed.
- Task 20: Removed SchedulerDaemon legacy AgentATickRunner path; Agent A now executes only through config-driven cron dispatch with registered `market_listener` runner and `--agents` gating.

- Task 21 follow-up: idempotency-path `coalesced_count` is `0` when re-dispatching the same scheduled timestamp in the dedupe test; diagnostics now assert the field presence and reason deterministically rather than assuming a coalesced backlog.

- Task 22: Durable scheduling integration coverage is stable and deterministic with fixed timestamps and temp sqlite, validating claim exclusivity, run idempotency, coalesce misfire accounting, and one-dispatch semantics across concurrent daemon instances.

- Task 23: Added a deterministic non-interactive E2E runbook script (`test/e2e-agent-scheduling.ts`) that validates exactly-one scheduled `react_goal` dispatch and DB linkage/status invariants, with recorded final-QA evidence artifacts.
