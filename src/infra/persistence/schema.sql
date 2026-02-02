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

-- Initialize schema version
INSERT OR IGNORE INTO meta (key, value, updated_at) 
VALUES ('schema_version', '1.0.0', strftime('%s', 'now') * 1000);

INSERT OR IGNORE INTO meta (key, value, updated_at)
VALUES ('initialized_at', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
