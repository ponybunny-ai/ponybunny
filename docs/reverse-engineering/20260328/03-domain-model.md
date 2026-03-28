# 03 - Domain Model

## 3.1 Core Entities

### Goal

The top-level unit of work. A user-defined objective with success criteria, budgets, and priority.

```typescript
interface Goal {
  id: string;                           // UUID v4
  created_at: number;                   // Unix timestamp (ms)
  updated_at: number;
  title: string;
  description: string;
  success_criteria: SuccessCriterion[];
  status: GoalStatus;
  priority: number;                     // 0-100
  allowed_actions?: string[];           // Per-goal tool allowlist
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
  spent_tokens: number;
  spent_time_minutes: number;
  spent_cost_usd: number;
  parent_goal_id?: string;             // Hierarchical decomposition
  tags?: string[];
  context?: Record<string, any>;
}

interface SuccessCriterion {
  description: string;
  type: 'deterministic' | 'heuristic';
  verification_method: string;
  required: boolean;
}
```

### WorkItem

A discrete unit of execution within a goal. Work items form a DAG (directed acyclic graph) via dependencies.

```typescript
interface WorkItem {
  id: string;
  goal_id: string;
  title: string;
  description: string;
  item_type: 'code' | 'test' | 'doc' | 'refactor' | 'analysis';
  status: WorkItemStatus;
  priority: number;
  dependencies: string[];              // IDs of prerequisite work items
  blocks: string[];                    // IDs of work items this blocks
  assigned_agent?: string;
  estimated_effort: 'S' | 'M' | 'L' | 'XL';
  retry_count: number;
  max_retries: number;                 // Default: 3
  verification_plan?: VerificationPlan;
  verification_status: 'not_started' | 'passed' | 'failed' | 'skipped';
  context?: Record<string, any>;
}

interface VerificationPlan {
  quality_gates: QualityGate[];
  acceptance_criteria: string[];
}

interface QualityGate {
  name: string;
  type: 'deterministic' | 'llm_review';
  command?: string;                    // Shell command for deterministic gates
  expected_exit_code?: number;
  review_prompt?: string;              // For LLM review gates
  required: boolean;                   // Required gates block completion on failure
}
```

### Run

A single execution attempt of a work item. Multiple runs may exist per work item (retries).

```typescript
interface Run {
  id: string;
  work_item_id: string;
  goal_id: string;
  agent_type: string;
  run_sequence: number;                // Incremented per retry
  status: RunStatus;
  exit_code?: number;
  error_message?: string;
  error_signature?: string;           // Normalized hash for pattern detection
  tokens_used: number;
  time_seconds?: number;
  cost_usd: number;
  artifacts: string[];                 // Artifact IDs
  execution_log?: string;
  context?: Record<string, any>;      // Includes evented_dispatch checkpoint
}
```

### Artifact

A generated output from a run.

```typescript
interface Artifact {
  id: string;
  run_id: string;
  work_item_id: string;
  goal_id: string;
  artifact_type: 'patch' | 'test_result' | 'log' | 'report' | 'binary';
  file_path?: string;
  content_hash: string;               // SHA256
  size_bytes: number;
  storage_type: 'inline' | 'file' | 'blob';
  content?: string;                    // For inline storage
  blob_path?: string;                  // For file/blob storage
  metadata?: Record<string, any>;
}
```

### Escalation

A structured request for human intervention.

```typescript
interface Escalation {
  id: string;
  work_item_id: string;
  goal_id: string;
  run_id?: string;
  escalation_type: 'stuck' | 'ambiguous' | 'risk' | 'credential' | 'validation_failed';
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  title: string;
  description: string;
  context_data?: EscalationContext;
  resolution_action?: 'user_input' | 'skip' | 'retry' | 'alternative_approach';
  resolution_data?: Record<string, any>;
  resolver?: string;
}

interface EscalationContext {
  error_signature?: string;
  retry_count?: number;
  last_error?: string;
  attempted_solutions?: string[];
  required_input?: string[];
  risk_assessment?: {
    impact: 'low' | 'medium' | 'high' | 'critical';
    affected_systems: string[];
    reversible: boolean;
  };
}
```

### Decision

Agent reasoning log for auditability.

```typescript
interface Decision {
  id: string;
  run_id: string;
  work_item_id: string;
  goal_id: string;
  decision_type: 'approach' | 'tool' | 'model' | 'retry' | 'escalate';
  decision_point: string;
  options_considered: DecisionOption[];
  selected_option: string;
  reasoning: string;
  confidence_score?: number;           // 0.0-1.0
}
```

### ContextPack

State snapshot for multi-day persistence and error recovery.

```typescript
interface ContextPack {
  id: string;
  goal_id: string;
  pack_type: 'daily_checkpoint' | 'error_recovery' | 'handoff';
  snapshot_data: ContextSnapshot;
  compressed: boolean;
  size_bytes: number;
}

interface ContextSnapshot {
  goal_state: {
    current_work_items: string[];
    completed_work_items: string[];
    blocked_work_items: string[];
    recent_decisions: Decision[];
    active_escalations: Escalation[];
  };
  execution_summary: {
    total_runs: number;
    success_count: number;
    failure_count: number;
    most_common_errors: { signature: string; count: number }[];
  };
  knowledge_base: {
    learned_patterns: string[];
    pitfalls_discovered: string[];
    successful_approaches: string[];
  };
  next_actions: {
    recommended_work_items: string[];
    risk_factors: string[];
    required_human_input?: string[];
  };
}
```

## 3.2 State Machines

### Goal State Machine

```
         ┌──────────────────────────────────────┐
         │                                      │
         ▼                                      │
    ┌─────────┐    ┌─────────┐    ┌───────────┐│
    │ queued   │───►│ active  │───►│ completed ││
    └────┬────┘    └────┬────┘    └───────────┘│
         │              │                       │
         │              ▼                       │
         │         ┌─────────┐                  │
         │         │ blocked │──────────────────┘
         │         └────┬────┘
         │              │
         ▼              ▼
    ┌───────────────────────┐
    │      cancelled        │
    └───────────────────────┘
```

| From | To | Trigger |
|------|-----|---------|
| queued | active | Scheduler starts processing |
| queued | cancelled | User cancels |
| active | blocked | Blocking escalation or budget exceeded |
| active | completed | All work items done |
| active | cancelled | User cancels |
| blocked | active | Escalation resolved |
| blocked | cancelled | User cancels |

### WorkItem State Machine

```
    ┌─────────┐    ┌─────────┐    ┌─────────────┐    ┌─────────┐    ┌──────┐
    │ queued   │───►│ ready   │───►│ in_progress │───►│ verify  │───►│ done │
    └────┬────┘    └────┬────┘    └──────┬──────┘    └────┬────┘    └──────┘
         │              │               │                  │
         │              │               ▼                  ▼
         │              │          ┌─────────┐        ┌─────────┐
         ├──────────────┼─────────►│ blocked │        │ failed  │
         │              │          └────┬────┘        └────┬────┘
         │              │               │                  │
         │              │               ▼                  ▼
         │              │◄──────────────┴──────────────────┘
         │              │           (retry path)
         └──────────────┘
```

| From | To | Trigger |
|------|-----|---------|
| queued | ready | Dependencies satisfied |
| queued | blocked | External block |
| ready | in_progress | Scheduler picks up |
| ready | blocked | External block |
| in_progress | verify | Execution complete, verification needed |
| in_progress | failed | Execution error |
| in_progress | blocked | External block |
| verify | done | All required quality gates passed |
| verify | failed | Required quality gate failed |
| failed | ready | Retry approved |
| failed | blocked | Escalation blocks retry |
| blocked | ready | Block resolved |

### Run State Machine

```
    ┌─────────┐───►┌─────────┐
    │ running │───►│ failure │
    └────┬────┘───►└─────────┘
         │    ───►┌─────────┐
         │        │ timeout │
         │        └─────────┘
         │    ───►┌─────────┐
         └───────►│ aborted │
                  └─────────┘
         ───►┌─────────┐
             │ success │
             └─────────┘
```

All run terminal states (success, failure, timeout, aborted) are final — no transitions out.

## 3.3 Domain Invariants

**Source**: `src/domain/work-order/invariants.ts`

### Goal Invariants
- Title is required (non-empty)
- At least one success criterion
- All budget values must be positive (if set)
- Spent values cannot exceed budget values

### WorkItem Invariants
- Must reference a valid `goal_id`
- Title is required
- Dependencies must not form cycles (DAG invariant)
- A work item is "ready" only when all dependencies have status `done`

### Escalation Invariants
- Escalation packets must be complete (context + attempts + analysis + options)
- All required fields present for the escalation type

## 3.4 Conversation Domain

### Conversation State Machine

```
States: idle → chatting → clarifying → executing → monitoring → reporting → retrying
```

| State | Entry Condition |
|-------|----------------|
| idle | Initial state |
| chatting | User sends message |
| clarifying | Goal has missing information |
| executing | Valid goal submitted to scheduler |
| monitoring | Active task being tracked |
| reporting | Task completed, generating report |
| retrying | Task failed, attempting recovery |

### Session Lifecycle

```
active → archived (with summary + metadata)
archived → active (resume)
```

Sessions include turn history, memory entries (embedding-based), and core memory summaries with importance scoring.

## 3.5 Permission Domain

### Three-Layer Responsibility Model

| Layer | Description | Examples |
|-------|-------------|---------|
| **Layer 1: Autonomous** | Tools the agent can use freely | read_file, list_dir, search_code |
| **Layer 2: Approval Required** | Tools requiring human approval | execute_command, write_file, web_search |
| **Layer 3: Forbidden** | Tools never available to agents | system commands, destructive operations |

### Tool Risk Levels
- `safe` — No side effects (reads, searches)
- `moderate` — Reversible side effects (file writes, git operations)
- `dangerous` — Irreversible side effects (shell execution, network requests)
- `critical` — System-level impact

Permission grants are cached with TTL and can be scoped per-goal.

## 3.6 Stuck Detection

Automated detection of stalled work items:

| Reason | Description |
|--------|-------------|
| `timeout_in_progress` | Work item stuck in `in_progress` too long |
| `timeout_ready` | Work item stuck in `ready` without being picked up |
| `repeated_same_error` | Same error signature seen multiple times |
| `max_retries_exceeded` | Retry limit reached |
| `circular_dependency` | Dependency cycle detected |
| `missing_dependency` | Referenced dependency doesn't exist |
| `no_progress` | No observable progress over time |

Actions: `retry`, `escalate`, `skip`, `reassign`, `split`, `unblock_dependency`, `increase_timeout`, `change_approach`
