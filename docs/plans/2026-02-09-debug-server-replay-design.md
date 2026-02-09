# Event Replay & Time Travel for Debug Server

## Overview
This document outlines the design for adding Event Replay and Time Travel capabilities to the PonyBunny debug server. This feature allows developers to replay past execution events, step through history, and inspect the exact state of the system at any point in time, enabling deep bug investigation and performance analysis.

## Architecture

### Core Components

1.  **Snapshot Manager**
    *   Captures state snapshots at strategic moments (goal start, phase transitions, errors).
    *   Compresses state data (JSON → gzip) for efficient storage.
    *   Prunes old snapshots based on retention policy.

2.  **Replay Engine**
    *   Reconstructs state by loading the nearest snapshot and replaying subsequent events.
    *   Maintains an in-memory state machine.
    *   Computes state diffs between events.
    *   Supports playback controls (play, pause, step, speed, seek).

3.  **Timeline Service**
    *   Provides REST/WebSocket APIs for timeline data.
    *   Generates metadata: phase boundaries, error markers, LLM call spans.
    *   Manages playback sessions.

## Data Model

### Database Schema (SQLite)

**`snapshots` Table**
```sql
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  trigger_type TEXT NOT NULL, -- 'goal_start', 'phase_transition', 'error', 'manual'
  trigger_event_id TEXT,
  state_data BLOB NOT NULL,   -- gzipped JSON
  size_bytes INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_snapshots_goal_timestamp ON snapshots(goal_id, timestamp DESC);
```

**`timeline_metadata` Table**
```sql
CREATE TABLE timeline_metadata (
  goal_id TEXT PRIMARY KEY,
  total_events INTEGER,
  start_time INTEGER,
  end_time INTEGER,
  duration_ms INTEGER,
  phase_boundaries TEXT,      -- JSON array
  error_markers TEXT,         -- JSON array
  llm_call_spans TEXT,        -- JSON array
  last_updated INTEGER
);
```

### State Structure
```typescript
interface SnapshotState {
  goal: CachedGoal;
  workItems: CachedWorkItem[];
  runs: CachedRun[];
  metrics: AggregatedMetrics;
  llmContext: {
    activeRequests: Array<{id: string; model: string; startTime: number}>;
    totalTokens: {input: number; output: number};
  };
}
```

## API Design

### REST Endpoints
*   `GET /api/replay/:goalId/timeline` - Get timeline metadata, phases, markers.
*   `GET /api/replay/:goalId/events` - Get events with pagination.
*   `GET /api/replay/:goalId/state/:timestamp` - Get reconstructed state at timestamp.
*   `GET /api/replay/:goalId/diff/:eventId` - Get state changes for an event.

### WebSocket Protocol
*   **Client -> Server**: `replay.start`, `replay.pause`, `replay.resume`, `replay.seek`, `replay.step`, `replay.speed`
*   **Server -> Client**: `replay.event`, `replay.batch`, `replay.complete`, `replay.error`

## Snapshot Strategy
*   **Triggers**:
    *   Goal created/completed/failed.
    *   Phase transitions (8-phase lifecycle).
    *   Error events.
    *   Time-based fallback (every 5 mins).

## Implementation Plan

### Phase 1: Foundation
1.  **Database Schema**: Create tables and indexes.
2.  **Snapshot Manager**: Implement capture, compression, and triggers.
3.  **Replay Engine Core**: Implement state reconstruction and diff logic.

### Phase 2: API Layer
1.  **Timeline API**: REST endpoints.
2.  **WebSocket Manager**: Session handling and event streaming.
3.  **Timeline Service**: Metadata computation and caching.

### Phase 3: Web UI
1.  **Timeline Components**: Player controls, track visualization.
2.  **State Inspector**: State viewer, diff view, metrics.
3.  **Navigation**: Search, filters, bookmarks.

### Phase 4: Optimization & Polish
1.  **Performance**: Caching, lazy loading, batching.
2.  **Robustness**: Error recovery, gap detection.
3.  **Testing**: E2E and performance tests.
