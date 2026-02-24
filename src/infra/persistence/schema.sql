-- Work Order System Database Schema
-- Version: 1.0.0
-- Purpose: Enable autonomous multi-day AI agent operations with structured goal/task management

-- ============================================================================
-- 1. GOALS Table
-- ============================================================================
-- High-level objectives with success criteria and resource budgets
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,            -- Unix timestamp (ms)
    updated_at INTEGER NOT NULL,            -- Unix timestamp (ms)
    
    -- Core Fields
    title TEXT NOT NULL,                    -- Human-readable goal name
    description TEXT NOT NULL,              -- Detailed goal specification
    success_criteria TEXT NOT NULL,         -- JSON array of verifiable conditions
    
    -- State Management
    status TEXT NOT NULL DEFAULT 'pending', -- pending | active | completed | cancelled | blocked
    priority INTEGER NOT NULL DEFAULT 50,   -- 0 (lowest) to 100 (highest)
    
    -- Resource Management
    budget_tokens INTEGER,                  -- Max LLM tokens allowed
    budget_time_minutes INTEGER,            -- Max wall-clock time
    budget_cost_usd REAL,                   -- Max monetary cost
    spent_tokens INTEGER DEFAULT 0,
    spent_time_minutes INTEGER DEFAULT 0,
    spent_cost_usd REAL DEFAULT 0.0,
    
    -- Relationships
    parent_goal_id TEXT,                    -- For hierarchical goal decomposition
    
    -- Metadata
    tags TEXT,                              -- JSON array for categorization
    context TEXT,                           -- JSON object with domain-specific data
    
    FOREIGN KEY (parent_goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_priority ON goals(priority DESC);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_goal_id);

-- ============================================================================
-- 2. WORK_ITEMS Table
-- ============================================================================
-- Granular executable tasks with dependency DAG
CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    
    -- Core Fields
    goal_id TEXT NOT NULL,                  -- Parent goal
    title TEXT NOT NULL,
    description TEXT NOT NULL,              -- Detailed task specification
    item_type TEXT NOT NULL,                -- code | test | doc | research | review | deploy
    
    -- State Management
    status TEXT NOT NULL DEFAULT 'pending', -- pending | ready | in_progress | completed | failed | blocked | skipped
    priority INTEGER NOT NULL DEFAULT 50,
    
    -- Dependency Management (DAG)
    dependencies TEXT,                      -- JSON array of work_item IDs that must complete first
    blocks TEXT,                            -- JSON array of work_item IDs blocked by this item
    
    -- Execution Metadata
    assigned_agent TEXT,                    -- Agent type/model assigned to execute
    estimated_effort TEXT,                  -- S | M | L | XL
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Verification
    verification_plan TEXT,                 -- JSON object describing quality gates
    verification_status TEXT,               -- not_started | passed | failed | skipped
    
    -- Context
    context TEXT,                           -- JSON object with task-specific data
    
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_items_goal ON work_items(goal_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_type ON work_items(item_type);

-- ============================================================================
-- 3. RUNS Table
-- ============================================================================
-- Execution records for work items (agent cycles)
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    
    -- Relationships
    work_item_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    
    -- Execution Context
    agent_type TEXT NOT NULL,               -- e.g., "claude-sonnet-3.5", "gpt-4"
    run_sequence INTEGER NOT NULL,          -- 1st attempt, 2nd attempt, etc.
    
    -- Outcome
    status TEXT NOT NULL,                   -- running | success | failure | timeout | aborted
    exit_code INTEGER,
    error_message TEXT,
    error_signature TEXT,                   -- Hash of error type for pattern detection
    
    -- Resource Usage
    tokens_used INTEGER DEFAULT 0,
    time_seconds INTEGER,
    cost_usd REAL DEFAULT 0.0,
    
    -- Artifacts & Logs
    artifacts TEXT,                         -- JSON array of artifact IDs generated
    execution_log TEXT,                     -- Detailed execution trace
    
    -- Context
    context TEXT,                           -- JSON object with run-specific data
    
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_work_item ON runs(work_item_id);
CREATE INDEX IF NOT EXISTS idx_runs_goal ON runs(goal_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_error_signature ON runs(error_signature);

-- ============================================================================
-- 4. ARTIFACTS Table
-- ============================================================================
-- Generated outputs (code patches, test results, documentation)
CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,
    
    -- Relationships
    run_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    
    -- Artifact Details
    artifact_type TEXT NOT NULL,            -- patch | test_result | log | report | binary
    file_path TEXT,                         -- Relative path in workspace
    content_hash TEXT,                      -- SHA256 for deduplication
    size_bytes INTEGER,
    
    -- Storage
    storage_type TEXT NOT NULL,             -- inline | file | blob
    content TEXT,                           -- Inline content (for small artifacts)
    blob_path TEXT,                         -- Path to stored file (for large artifacts)
    
    -- Metadata
    metadata TEXT,                          -- JSON object with artifact-specific data
    
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_work_item ON artifacts(work_item_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_goal ON artifacts(goal_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_hash ON artifacts(content_hash);

-- ============================================================================
-- 5. DECISIONS Table
-- ============================================================================
-- Agent reasoning log (why Agent chose X over Y)
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,
    
    -- Relationships
    run_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    
    -- Decision Context
    decision_type TEXT NOT NULL,            -- approach | tool | model | retry | escalate
    decision_point TEXT NOT NULL,           -- Description of what was being decided
    
    -- Options Considered
    options_considered TEXT NOT NULL,       -- JSON array of alternatives
    selected_option TEXT NOT NULL,          -- The chosen option
    reasoning TEXT NOT NULL,                -- Why this option was selected
    
    -- Metadata
    confidence_score REAL,                  -- 0.0 to 1.0
    metadata TEXT,                          -- JSON object with decision-specific data
    
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_decisions_work_item ON decisions(work_item_id);
CREATE INDEX IF NOT EXISTS idx_decisions_goal ON decisions(goal_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision_type);

-- ============================================================================
-- 6. ESCALATIONS Table
-- ============================================================================
-- Human intervention requests
CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    
    -- Relationships
    work_item_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    run_id TEXT,                            -- May be NULL if escalation is pre-execution
    
    -- Escalation Details
    escalation_type TEXT NOT NULL,          -- stuck | ambiguous | risk | credential | validation_failed
    severity TEXT NOT NULL,                 -- low | medium | high | critical
    status TEXT NOT NULL DEFAULT 'open',    -- open | acknowledged | resolved | dismissed
    
    -- Context
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    context_data TEXT,                      -- JSON object with all relevant data
    
    -- Resolution
    resolution_action TEXT,                 -- user_input | skip | retry | alternative_approach
    resolution_data TEXT,                   -- JSON object with resolution details
    resolver TEXT,                          -- User ID or system identifier
    
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_work_item ON escalations(work_item_id);
CREATE INDEX IF NOT EXISTS idx_escalations_goal ON escalations(goal_id);
CREATE INDEX IF NOT EXISTS idx_escalations_severity ON escalations(severity);

-- ============================================================================
-- 7. CONTEXT_PACKS Table
-- ============================================================================
-- Structured state snapshots for multi-day persistence
CREATE TABLE IF NOT EXISTS context_packs (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,
    
    -- Relationships
    goal_id TEXT NOT NULL,
    
    -- Context Details
    pack_type TEXT NOT NULL,                -- daily_checkpoint | error_recovery | handoff
    snapshot_data TEXT NOT NULL,            -- JSON object with complete state
    
    -- Metadata
    compressed BOOLEAN DEFAULT 0,           -- Whether snapshot_data is compressed
    size_bytes INTEGER,
    metadata TEXT,
    
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_context_packs_goal ON context_packs(goal_id);
CREATE INDEX IF NOT EXISTS idx_context_packs_type ON context_packs(pack_type);
CREATE INDEX IF NOT EXISTS idx_context_packs_created ON context_packs(created_at DESC);

-- ============================================================================
-- 8. META Table
-- ============================================================================
-- Database metadata and migration tracking
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- ============================================================================
-- 9. PAIRING_TOKENS Table
-- ============================================================================
-- Gateway authentication tokens for client pairing
CREATE TABLE IF NOT EXISTS pairing_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    public_key TEXT,                        -- Bound after successful pairing
    permissions TEXT NOT NULL,              -- JSON array of permissions
    created_at INTEGER NOT NULL,
    expires_at INTEGER,                     -- NULL = never expires
    revoked_at INTEGER                      -- NULL = not revoked
);

CREATE INDEX IF NOT EXISTS idx_pairing_tokens_hash ON pairing_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_public_key ON pairing_tokens(public_key);

-- ============================================================================
-- 10. AUDIT_LOGS Table
-- ============================================================================
-- Comprehensive audit trail for all system operations
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,                    -- UUID v4
    timestamp INTEGER NOT NULL,             -- Unix timestamp (ms)

    -- Actor information
    actor TEXT NOT NULL,                    -- publicKey, 'system', 'daemon', or agent identifier
    actor_type TEXT NOT NULL,               -- user | system | daemon | agent | scheduler | gateway

    -- Action details
    action TEXT NOT NULL,                   -- e.g., 'goal.created', 'tool.invoked'
    entity_type TEXT NOT NULL,              -- goal | work_item | run | artifact | escalation | session | tool | auth | permission
    entity_id TEXT NOT NULL,                -- ID of the affected entity

    -- Related entities for easier querying
    goal_id TEXT,
    work_item_id TEXT,
    run_id TEXT,
    session_id TEXT,

    -- Change tracking
    old_value TEXT,                         -- JSON: previous value
    new_value TEXT,                         -- JSON: new value

    -- Additional context
    metadata TEXT,                          -- JSON: extra context

    -- Request context
    ip_address TEXT,
    user_agent TEXT
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_goal ON audit_logs(goal_id);
CREATE INDEX IF NOT EXISTS idx_audit_work_item ON audit_logs(work_item_id);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id);

-- ============================================================================
-- 11. PERMISSION_REQUESTS Table
-- ============================================================================
-- Permission requests for Layer 2 (approval_required) operations
CREATE TABLE IF NOT EXISTS permission_requests (
    id TEXT PRIMARY KEY,                    -- UUID v4
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,

    -- Tool information
    tool_name TEXT NOT NULL,
    layer TEXT NOT NULL,                    -- 'approval_required'

    -- Context
    goal_id TEXT NOT NULL,
    work_item_id TEXT,
    run_id TEXT,

    -- Request details
    reason TEXT NOT NULL,
    args_summary TEXT NOT NULL,             -- Sanitized summary of arguments

    -- Status
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied | expired

    -- Resolution
    resolved_at INTEGER,
    resolved_by TEXT,
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_perm_req_goal ON permission_requests(goal_id);
CREATE INDEX IF NOT EXISTS idx_perm_req_status ON permission_requests(status);
CREATE INDEX IF NOT EXISTS idx_perm_req_expires ON permission_requests(expires_at);

-- ============================================================================
-- 12. PERMISSION_GRANTS Table
-- ============================================================================
-- Cached permission grants for approved operations
CREATE TABLE IF NOT EXISTS permission_grants (
    tool_name TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    granted_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    granted_by TEXT NOT NULL,
    scope TEXT,                             -- Optional scope limitation
    PRIMARY KEY (tool_name, goal_id)
);

CREATE INDEX IF NOT EXISTS idx_perm_grant_expires ON permission_grants(expires_at);

-- ============================================================================
-- 13. SESSIONS Table
-- ============================================================================
-- Conversation sessions for persistent chat state
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,                    -- UUID v4
    persona_id TEXT NOT NULL,
    state TEXT NOT NULL,                    -- idle | clarifying | executing | monitoring | retrying
    active_goal_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER,
    metadata TEXT                           -- JSON
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_persona ON sessions(persona_id);
CREATE INDEX IF NOT EXISTS idx_sessions_goal ON sessions(active_goal_id);

-- ============================================================================
-- 14. SESSION_TURNS Table
-- ============================================================================
-- Individual conversation turns within sessions
CREATE TABLE IF NOT EXISTS session_turns (
    id TEXT PRIMARY KEY,                    -- UUID v4
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,                     -- 'user' | 'assistant'
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    attachments TEXT,                       -- JSON array
    metadata TEXT,                          -- JSON
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_turns_session ON session_turns(session_id, timestamp);

CREATE TABLE IF NOT EXISTS memory_entries (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    turn_id TEXT UNIQUE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    embedding_dim INTEGER NOT NULL,
    embedding_model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_session_created
ON memory_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_model_dim
ON memory_entries(embedding_model, embedding_dim);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
    content,
    entry_id UNINDEXED,
    session_id UNINDEXED,
    role UNINDEXED,
    content='memory_entries',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_entries_fts(rowid, content, entry_id, session_id, role)
    VALUES (new.rowid, new.content, new.entry_id, new.session_id, new.role);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN
    INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content, entry_id, session_id, role)
    VALUES ('delete', old.rowid, old.content, old.entry_id, old.session_id, old.role);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_au AFTER UPDATE ON memory_entries BEGIN
    INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content, entry_id, session_id, role)
    VALUES ('delete', old.rowid, old.content, old.entry_id, old.session_id, old.role);
    INSERT INTO memory_entries_fts(rowid, content, entry_id, session_id, role)
    VALUES (new.rowid, new.content, new.entry_id, new.session_id, new.role);
END;

CREATE TABLE IF NOT EXISTS embedding_cache (
    cache_key TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedding_dim INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (cache_key, embedding_model)
);

CREATE INDEX IF NOT EXISTS idx_embedding_cache_lru
ON embedding_cache(last_accessed_at ASC);

CREATE TABLE IF NOT EXISTS core_memories (
    memory_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    owner_type TEXT NOT NULL DEFAULT 'agent',
    owner_id TEXT NOT NULL DEFAULT 'legacy-default-agent',
    turn_id TEXT UNIQUE,
    role TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    summary TEXT NOT NULL,
    importance REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (memory_id)
);

CREATE INDEX IF NOT EXISTS idx_core_memories_session_created
ON core_memories(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_memories_owner
ON core_memories(session_id, owner_type, owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_memories_importance
ON core_memories(session_id, importance DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS core_memories_fts USING fts5(
    summary,
    raw_content,
    memory_id UNINDEXED,
    session_id UNINDEXED,
    content='core_memories',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS core_memories_ai AFTER INSERT ON core_memories BEGIN
    INSERT INTO core_memories_fts(rowid, summary, raw_content, memory_id, session_id)
    VALUES (new.rowid, new.summary, new.raw_content, new.memory_id, new.session_id);
END;

CREATE TRIGGER IF NOT EXISTS core_memories_ad AFTER DELETE ON core_memories BEGIN
    INSERT INTO core_memories_fts(core_memories_fts, rowid, summary, raw_content, memory_id, session_id)
    VALUES ('delete', old.rowid, old.summary, old.raw_content, old.memory_id, old.session_id);
END;

CREATE TRIGGER IF NOT EXISTS core_memories_au AFTER UPDATE ON core_memories BEGIN
    INSERT INTO core_memories_fts(core_memories_fts, rowid, summary, raw_content, memory_id, session_id)
    VALUES ('delete', old.rowid, old.summary, old.raw_content, old.memory_id, old.session_id);
    INSERT INTO core_memories_fts(rowid, summary, raw_content, memory_id, session_id)
    VALUES (new.rowid, new.summary, new.raw_content, new.memory_id, new.session_id);
END;

-- ============================================================================
-- ============================================================================
-- Durable recurring schedules for agents
CREATE TABLE IF NOT EXISTS cron_jobs (
    agent_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    schedule_cron TEXT,
    schedule_timezone TEXT,
    schedule_interval_ms INTEGER,
    next_run_at_ms INTEGER,
    last_run_at_ms INTEGER,
    in_flight_run_key TEXT,
    in_flight_goal_id TEXT,
    in_flight_started_at_ms INTEGER,
    claimed_at_ms INTEGER,
    claimed_by TEXT,
    claim_expires_at_ms INTEGER,
    definition_hash TEXT NOT NULL,
    backoff_until_ms INTEGER,
    failure_count INTEGER NOT NULL DEFAULT 0,
    CHECK (
        (schedule_cron IS NOT NULL AND schedule_interval_ms IS NULL)
        OR (schedule_cron IS NULL AND schedule_interval_ms IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled_next_run ON cron_jobs(enabled, next_run_at_ms);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_claim_expires ON cron_jobs(claim_expires_at_ms);

-- ============================================================================
-- ============================================================================
-- Scheduled run records for recurring agents
CREATE TABLE IF NOT EXISTS cron_job_runs (
    run_key TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    scheduled_for_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    goal_id TEXT,
    status TEXT NOT NULL,
    UNIQUE (agent_id, scheduled_for_ms)
);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_agent_scheduled ON cron_job_runs(agent_id, scheduled_for_ms);

-- Update schema version
INSERT OR REPLACE INTO meta (key, value, updated_at)
VALUES ('schema_version', '1.3.0', strftime('%s', 'now') * 1000);

-- Initialize schema version
INSERT OR IGNORE INTO meta (key, value, updated_at)
VALUES ('schema_version', '1.2.0', strftime('%s', 'now') * 1000);

INSERT OR IGNORE INTO meta (key, value, updated_at)
VALUES ('initialized_at', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
