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
