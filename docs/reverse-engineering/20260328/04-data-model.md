# 04 - Data Model

## 4.1 Overview

PonyBunny uses **SQLite** via `better-sqlite3` as its embedded database. The database is split into two schema files:

- **`schema.sql`** — Core work order system (goals, work items, runs, artifacts, escalations, audit, permissions, cron)
- **`schema-memory.sql`** — Session and memory system (sessions, turns, embeddings, core memories)
- **`schema-migration-v2.sql`** — Adds `allowed_actions` column to goals table

## 4.2 Core Work Order Tables

### goals

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER | Unix timestamp (ms) |
| updated_at | INTEGER | Unix timestamp (ms) |
| title | TEXT NOT NULL | |
| description | TEXT NOT NULL | |
| success_criteria | TEXT NOT NULL | JSON array of SuccessCriterion |
| status | TEXT DEFAULT 'pending' | pending, active, blocked, completed, cancelled |
| priority | INTEGER DEFAULT 50 | 0-100 |
| allowed_actions | TEXT | JSON array (added in migration v2) |
| budget_tokens | INTEGER | |
| budget_time_minutes | INTEGER | |
| budget_cost_usd | REAL | |
| spent_tokens | INTEGER DEFAULT 0 | |
| spent_time_minutes | REAL DEFAULT 0 | |
| spent_cost_usd | REAL DEFAULT 0 | |
| parent_goal_id | TEXT | FK to goals.id (hierarchical) |
| tags | TEXT | JSON array |
| context | TEXT | JSON object |

**Indexes**: status, priority DESC, parent_goal_id

### work_items

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER | |
| updated_at | INTEGER | |
| goal_id | TEXT NOT NULL | FK to goals |
| title | TEXT NOT NULL | |
| description | TEXT NOT NULL | |
| item_type | TEXT NOT NULL | code, test, doc, refactor, analysis |
| status | TEXT DEFAULT 'pending' | queued, ready, in_progress, verify, done, failed, blocked |
| priority | INTEGER DEFAULT 50 | |
| dependencies | TEXT | JSON array of work item IDs |
| blocks | TEXT | JSON array of work item IDs |
| assigned_agent | TEXT | |
| estimated_effort | TEXT | S, M, L, XL |
| retry_count | INTEGER DEFAULT 0 | |
| max_retries | INTEGER DEFAULT 3 | |
| verification_plan | TEXT | JSON VerificationPlan |
| verification_status | TEXT | not_started, passed, failed, skipped |
| context | TEXT | JSON object |

**Indexes**: goal_id, status, priority DESC, item_type

### runs

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER | |
| completed_at | INTEGER | |
| work_item_id | TEXT NOT NULL | FK to work_items |
| goal_id | TEXT NOT NULL | FK to goals |
| agent_type | TEXT NOT NULL | |
| run_sequence | INTEGER NOT NULL | Incremented per retry |
| status | TEXT NOT NULL | running, success, failure, timeout, aborted |
| exit_code | INTEGER | |
| error_message | TEXT | |
| error_signature | TEXT | Normalized hash for pattern detection |
| tokens_used | INTEGER | |
| time_seconds | INTEGER | |
| cost_usd | REAL | |
| artifacts | TEXT | JSON array of artifact IDs |
| execution_log | TEXT | |
| context | TEXT | JSON object (includes evented_dispatch) |

**Indexes**: work_item_id, goal_id, status, error_signature

### run_events (Deterministic Event Log)

| Column | Type | Notes |
|--------|------|-------|
| sequence | INTEGER PK AUTOINCREMENT | |
| event_id | TEXT | |
| run_id | TEXT | |
| plan_id | TEXT | |
| event_type | TEXT NOT NULL | |
| ts_ms | INTEGER NOT NULL | |
| payload_json | TEXT NOT NULL | |

**Indexes**: (run_id, sequence), (run_id, ts_ms), event_type

### runtime_events

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| type | TEXT | |
| source | TEXT | |
| timestamp | INTEGER NOT NULL | |
| work_item_id | TEXT | |
| goal_id | TEXT | |
| run_id | TEXT | |
| payload_json | TEXT | |

**Indexes**: (goal_id, timestamp DESC), timestamp DESC

### artifacts

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER NOT NULL | |
| run_id | TEXT NOT NULL | |
| work_item_id | TEXT NOT NULL | |
| goal_id | TEXT NOT NULL | |
| artifact_type | TEXT NOT NULL | patch, test_result, log, report, binary |
| file_path | TEXT | |
| content_hash | TEXT | SHA256 |
| size_bytes | INTEGER | |
| storage_type | TEXT NOT NULL | inline, file, blob |
| content | TEXT | For inline storage |
| blob_path | TEXT | For file/blob storage |
| metadata | TEXT | JSON object |

**Indexes**: run_id, work_item_id, goal_id, artifact_type, content_hash

### decisions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER NOT NULL | |
| run_id | TEXT NOT NULL | |
| work_item_id | TEXT NOT NULL | |
| goal_id | TEXT NOT NULL | |
| decision_type | TEXT NOT NULL | approach, tool, model, retry, escalate |
| decision_point | TEXT NOT NULL | |
| options_considered | TEXT NOT NULL | JSON array |
| selected_option | TEXT NOT NULL | |
| reasoning | TEXT NOT NULL | |
| confidence_score | REAL | 0.0-1.0 |
| metadata | TEXT | JSON object |

**Indexes**: run_id, work_item_id, goal_id, decision_type

### escalations

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER | |
| resolved_at | INTEGER | |
| work_item_id | TEXT | |
| goal_id | TEXT | |
| run_id | TEXT | |
| escalation_type | TEXT NOT NULL | stuck, ambiguous, risk, credential, validation_failed |
| severity | TEXT NOT NULL | low, medium, high, critical |
| status | TEXT DEFAULT 'open' | open, acknowledged, resolved, dismissed |
| title | TEXT NOT NULL | |
| description | TEXT NOT NULL | |
| context_data | TEXT | JSON EscalationContext |
| resolution_action | TEXT | |
| resolution_data | TEXT | JSON object |
| resolver | TEXT | |

**Indexes**: status, work_item_id, goal_id, severity

### context_packs

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER NOT NULL | |
| goal_id | TEXT NOT NULL | |
| pack_type | TEXT NOT NULL | daily_checkpoint, error_recovery, handoff |
| snapshot_data | TEXT NOT NULL | JSON ContextSnapshot |
| compressed | BOOLEAN DEFAULT 0 | |
| size_bytes | INTEGER | |
| metadata | TEXT | JSON object |

**Indexes**: goal_id, pack_type, created_at DESC

## 4.3 Authentication & Authorization Tables

### pairing_tokens

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| token_hash | TEXT UNIQUE | SHA256(token) |
| public_key | TEXT | Ed25519 32-byte public key |
| permissions | TEXT NOT NULL | JSON array: ['read', 'write', 'admin'] |
| created_at | INTEGER | |
| expires_at | INTEGER | |
| revoked_at | INTEGER | |

### permission_requests

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| created_at | INTEGER NOT NULL | |
| expires_at | INTEGER NOT NULL | |
| tool_name | TEXT NOT NULL | |
| layer | TEXT NOT NULL | Responsibility layer |
| goal_id | TEXT | |
| work_item_id | TEXT | |
| run_id | TEXT | |
| reason | TEXT NOT NULL | |
| args_summary | TEXT NOT NULL | |
| status | TEXT DEFAULT 'pending' | pending, approved, denied, expired |
| resolved_at | INTEGER | |
| resolved_by | TEXT | |
| resolution_note | TEXT | |

### permission_grants

| Column | Type | Notes |
|--------|------|-------|
| tool_name | TEXT NOT NULL | Composite PK with goal_id |
| goal_id | TEXT NOT NULL | |
| granted_at | INTEGER NOT NULL | |
| expires_at | INTEGER NOT NULL | TTL-based cache |
| granted_by | TEXT | |
| scope | TEXT | |

### audit_logs

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID v4 |
| timestamp | INTEGER NOT NULL | |
| actor | TEXT NOT NULL | publicKey, 'system', 'daemon', 'agent' |
| actor_type | TEXT NOT NULL | user, system, daemon, agent, scheduler, gateway |
| action | TEXT NOT NULL | |
| entity_type | TEXT NOT NULL | |
| entity_id | TEXT NOT NULL | |
| goal_id | TEXT | |
| work_item_id | TEXT | |
| run_id | TEXT | |
| session_id | TEXT | |
| old_value | TEXT | JSON (previous state) |
| new_value | TEXT | JSON (new state) |
| metadata | TEXT | JSON |
| ip_address | TEXT | |
| user_agent | TEXT | |

**Indexes**: timestamp DESC, (entity_type, entity_id), goal_id, work_item_id, run_id, actor, action, session_id

## 4.4 Cron Scheduling Tables

### cron_jobs

| Column | Type | Notes |
|--------|------|-------|
| agent_id | TEXT PK | |
| enabled | BOOLEAN DEFAULT 1 | |
| schedule_cron | TEXT | Cron expression (XOR with interval) |
| schedule_timezone | TEXT | |
| schedule_interval_ms | INTEGER | Interval (XOR with cron) |
| next_run_at_ms | INTEGER | |
| last_run_at_ms | INTEGER | |
| in_flight_run_key | TEXT | Current executing run |
| in_flight_goal_id | TEXT | |
| in_flight_started_at_ms | INTEGER | |
| claimed_at_ms | INTEGER | Distributed locking |
| claimed_by | TEXT | |
| claim_expires_at_ms | INTEGER | |
| definition_hash | TEXT NOT NULL | |
| backoff_until_ms | INTEGER | Failure backoff |
| failure_count | INTEGER DEFAULT 0 | |

**Constraint**: schedule_cron XOR schedule_interval_ms (exactly one must be set)

### cron_job_runs

| Column | Type | Notes |
|--------|------|-------|
| run_key | TEXT PK | |
| agent_id | TEXT NOT NULL | |
| scheduled_for_ms | INTEGER NOT NULL | |
| created_at_ms | INTEGER NOT NULL | |
| goal_id | TEXT | Linked after submission |
| status | TEXT NOT NULL | pending, claimed, submitted, running, success, failure |

## 4.5 Session & Memory Tables

### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| persona_id | TEXT NOT NULL | |
| state | TEXT NOT NULL | Conversation state |
| lifecycle_state | TEXT DEFAULT 'active' | active, archived |
| active_goal_id | TEXT | |
| created_at | INTEGER NOT NULL | |
| updated_at | INTEGER NOT NULL | |
| expires_at | INTEGER | |
| archived_at | INTEGER | |
| archive_summary | TEXT | |
| archive_metadata | TEXT | JSON |
| metadata | TEXT | JSON |

### session_turns

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| session_id | TEXT NOT NULL | FK to sessions |
| role | TEXT NOT NULL | user, assistant, system |
| content | TEXT NOT NULL | |
| timestamp | INTEGER NOT NULL | |
| attachments | TEXT | JSON |
| metadata | TEXT | JSON |

### memory_entries

| Column | Type | Notes |
|--------|------|-------|
| rowid | INTEGER PK AUTOINCREMENT | |
| entry_id | TEXT UNIQUE | |
| session_id | TEXT | |
| turn_id | TEXT | |
| role | TEXT NOT NULL | |
| content | TEXT NOT NULL | |
| embedding | BLOB NOT NULL | Vector embedding |
| embedding_dim | INTEGER NOT NULL | |
| embedding_model | TEXT NOT NULL | |
| created_at | INTEGER NOT NULL | |
| updated_at | INTEGER NOT NULL | |

**FTS5 index**: `memory_entries_fts` on content (with auto-sync triggers)

### embedding_cache

LRU cache for embedding vectors:

| Column | Type | Notes |
|--------|------|-------|
| cache_key | TEXT NOT NULL | Composite PK with embedding_model |
| embedding_model | TEXT NOT NULL | |
| embedding_dim | INTEGER NOT NULL | |
| embedding | BLOB NOT NULL | |
| created_at | INTEGER NOT NULL | |
| last_accessed_at | INTEGER NOT NULL | For LRU eviction |
| access_count | INTEGER NOT NULL | |

### core_memories

Summarized memories with importance scoring:

| Column | Type | Notes |
|--------|------|-------|
| memory_id | TEXT UNIQUE PK | |
| session_id | TEXT NOT NULL | |
| owner_type | TEXT DEFAULT 'agent' | |
| owner_id | TEXT DEFAULT 'legacy-default-agent' | |
| turn_id | TEXT | |
| role | TEXT | |
| raw_content | TEXT NOT NULL | |
| summary | TEXT NOT NULL | |
| importance | REAL NOT NULL | Importance score |
| created_at | INTEGER NOT NULL | |
| updated_at | INTEGER NOT NULL | |

**FTS5 index**: `core_memories_fts` on summary (with auto-sync triggers)
**Indexes**: (session_id, importance DESC), (session_id, owner_type, owner_id, created_at DESC)

### meta

Key-value metadata table:

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | |
| value | TEXT NOT NULL | |
| updated_at | INTEGER NOT NULL | |

## 4.6 Repository Interface Summary

### IWorkOrderRepository

**Goal**: createGoal, getGoal, updateGoalStatus, deleteGoal, listGoals, updateGoalSpending

**WorkItem**: createWorkItem, getWorkItem, updateWorkItemStatus, getReadyWorkItems, getWorkItemsByGoal, getBlockedWorkItems, incrementWorkItemRetry, updateWorkItemStatusIfDependenciesMet

**Run**: createRun, getRun, getRunInspection, completeRun, getRunsByWorkItem, mergeRunContext, getRepeatedErrorSignatures, listInFlightRunReconciliationCandidates

**Evented Run Recovery**: precheckEventedManualReplay, startEventedManualReplay, markEventedRunOrphaned, markEventedRunRecoveryCandidate, clearEventedRunRecoveryCandidate, markEventedRunReplayCandidate, listEventedInFlightRunInspections, listEventedOrphanedRunInspections, getEventedRunReconciliationSummary

**Run Events**: appendRunEvent, listRunEvents, pruneRunEvents

**Other**: createArtifact, createDecision, createEscalation, createContextPack

**Cron**: upsertCronJob, getCronJob, listCronJobs, claimDueCronJobs, markCronJobInFlight, updateCronJobAfterOutcome, getOrCreateCronJobRun, linkCronJobRunToGoal, updateCronJobRunStatus

### AuditLogRepository

log, logBatch, getById, getByEntityId, getByGoalId, getByActor, getByAction, getByActionPrefix, getByTimeRange, getRecent, prune, count, getStatistics

### PermissionRepository

createRequest, getRequest, getPendingRequests, resolveRequest, expireOldRequests, grantPermission, getGrant, revokeGrant, revokeAllForGoal, cleanupExpiredGrants, getStatistics

### SqliteSessionRepository

Session CRUD, turn management, lifecycle state, archive/resume

### SqliteMemoryRepository

Vector search (cosine similarity), keyword search (FTS5), importance-based ranking, owner-scoped memory, embedding cache with LRU eviction

## 4.7 Error Signature Computation

The repository normalizes error messages to compute stable error signatures for pattern detection:

```
Normalization rules:
  - File paths → <PATH>
  - Numbers → <NUM>
  - Hex strings → <HEX>
  - Whitespace collapsed
  - Case normalized

Result: SHA256 hash of normalized message
```

This allows detecting repeated error patterns across retries and triggering escalation when the same error signature appears too many times.
