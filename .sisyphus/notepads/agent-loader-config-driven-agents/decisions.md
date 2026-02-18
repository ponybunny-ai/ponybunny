- Required agent.json fields include schemaVersion, id, name, enabled, type, schedule, policy, and runner to ensure v1 completeness.
- Policy allows flexible prompts/limits maps while keeping strict unknown-property rejection elsewhere.
- Agent discovery prefers user over workspace for identical IDs and uses source precedence plus idMatch to resolve realpath duplicates.
- AgentRegistry uses sha256 over canonicalized agent.json for definitionHash and keeps in-memory last-good definitions for invalid reloads.
- Agent A policy maps tool allowlist/prompts/limits to policy fields, while rate limits, circuit breaker, and tick defaults live under runner.config.
- RunnerRegistry.resolve throws a deterministic error for enabled agents with unknown types and returns null for disabled agents without a registered runner.
- Coalesce interval helper snaps to latest interval boundary and returns the next scheduled time; idempotency key uses agentId + ':' + scheduledForMs.
- Schema test executes schema.sql directly to avoid Jest import.meta limitations while still validating initialization.
- Unique agent_id enforced via PRIMARY KEY to keep cron_jobs one row per agent.
- Cron job claims use UPDATE guards with claim_expires_at_ms and in_flight_run_key to guarantee single-winner leases across instances.
- Schema resolution now uses module-relative URLs, with a fallback to __filename-based file URL when import.meta is unavailable in Jest.
- Cron job reconciliation disables missing agents by upserting enabled=false with existing schedule/definition_hash.

- Scheduler daemon PID lock file stored under config dir resolved by getConfigDir (respects PONYBUNNY_CONFIG_DIR).

- WorkItemManager calls updateWorkItemStatusIfDependenciesMet and refreshes queued items to ready before returning them for execution.

- Cron adapter lives in src/infra/scheduler/cron-adapter.ts and is the only module that depends on cron-parser.

- Schedule computation treats coalesced_count as missed firings beyond the first due run, with interval schedules dispatching immediately when no prior run metadata exists.
