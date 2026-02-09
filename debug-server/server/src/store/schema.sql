-- Debug Server SQLite Schema

-- Events table (core)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  goal_id TEXT,
  work_item_id TEXT,
  run_id TEXT,
  data JSON NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_goal_id ON events(goal_id);
CREATE INDEX IF NOT EXISTS idx_events_work_item_id ON events(work_item_id);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);

-- Goals cache (latest state)
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  title TEXT,
  data JSON NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

-- WorkItems cache
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  data JSON NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_items_goal ON work_items(goal_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);

-- Runs cache
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSON NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_work_item ON runs(work_item_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- Aggregated metrics (by time window)
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  data JSON NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_window ON metrics(window_start, window_end);

-- Snapshots table (for replay)
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_event_id TEXT,
  state_data BLOB NOT NULL,
  size_bytes INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_goal_timestamp ON snapshots(goal_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_trigger_type ON snapshots(trigger_type);

-- Timeline metadata (precomputed for fast replay UI)
CREATE TABLE IF NOT EXISTS timeline_metadata (
  goal_id TEXT PRIMARY KEY,
  total_events INTEGER NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  phase_boundaries TEXT,
  error_markers TEXT,
  llm_call_spans TEXT,
  last_updated INTEGER NOT NULL
);
