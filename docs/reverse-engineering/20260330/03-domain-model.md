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

### GlobalKnowledge

Cross-goal learning entries extracted from ContextPack knowledge bases.

```typescript
interface GlobalKnowledgeEntry {
  id: string;
  knowledge_type: 'pitfall' | 'pattern' | 'approach' | 'decision';
  domain_tags: string[];
  content: string;
  confidence: number;                  // 0.0-1.0
  occurrence_count: number;
  last_reinforced_at: number;
  source_goal_id?: string;
}
```

**GlobalKnowledgeService** methods:
- `extractFromContextPack(pack)` — Extract pitfalls/patterns from ContextPack snapshots
- `getRelevantKnowledge(type, tags, threshold)` — Query by type, domain tags, confidence
- `record(entry)` — Insert new knowledge (deduplicates by type + content)
- `reinforce(id)` — Bumps confidence, occurrence_count, last_reinforced_at

### GoalEvaluationReport (ADR-001 Phase 5)

Observational report produced by PostGoalEvaluator after goal completion or failure. Persisted to `goal_evaluation_reports` table (ADR-002 migration v3).

```typescript
interface GoalEvaluationReport {
  goalId: string;
  timestamp: number;
  trigger: 'goal_completed' | 'goal_failed' | 'goal_blocked';
  workItemResults: WorkItemEvaluation[];
  summary: {
    total: number;
    publish: number;
    retry: number;
    replan: number;
    escalate: number;
    skipped: number;
  };
  unactionableDecisions: string[];
}

interface WorkItemEvaluation {
  workItemId: string;
  runId: string | null;
  evaluation: EvaluationResult | null;
  skipped: boolean;
}
```

## 3.2 State Machines

### Goal State Machine

```
         ┌──────────────────────────────────────────────┐
         │                                              │
         ▼                                              │
    ┌─────────┐    ┌─────────────┐    ┌───────────┐    │
    │ queued   │───►│ plan_review │───►│  active   │───►│
    └────┬────┘    └──────┬──────┘    └────┬──────┘    │
         │                │                │            │
         │                │                ▼            │
         │                │           ┌─────────┐      │
         │                │           │ blocked │──────┘
         │                │           └────┬────┘
         │                │                │
         ▼                ▼                ▼
    ┌────────────────────────────────────────┐    ┌───────────┐
    │            cancelled                    │    │ completed │
    └────────────────────────────────────────┘    └───────────┘
```

| From | To | Trigger |
|------|-----|---------|
| queued | plan_review | GoalHarness completes planning with `context.review_plan: true` |
| queued | active | GoalHarness completes elaboration + planning, delegates to SchedulerCore |
| queued | cancelled | User cancels |
| plan_review | active | User approves plan (`plan.approve` RPC) |
| plan_review | cancelled | User rejects plan (`plan.reject` RPC) |
| active | blocked | Blocking escalation or budget exceeded |
| active | completed | All work items done (triggers PostGoalEvaluator) |
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

### GoalHarness Invariants (ADR-001)
- Every goal passes through elaboration before work items are created
- Every work item executes through SchedulerCore (budget, retry, events, quality gates)
- GoalHarness never performs execution
- SchedulerCore never performs elaboration or planning
- PostGoalEvaluator never modifies scheduler state

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

Sessions include turn history, memory entries (embedding-based with LRU cache — ADR-002), and core memory summaries with importance scoring.

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

## 3.7 Audit Naming Convention (ADR-002)

**Source**: `src/domain/audit/audit-naming.ts`

### Prefixed Action Format

```
{source}.{entity}.{verb}
```

| Source | Actor Types | Examples |
|--------|------------|---------|
| `user` | user | `user.goal.submit`, `user.escalation.respond` |
| `system` | daemon, scheduler, gateway | `system.workitem.retry`, `system.goal.complete` |
| `agent` | agent | `agent.tool.call`, `agent.decision.record` |

### Actor Type Mapping

```typescript
actorTypeToSource(actorType: ActorType): AuditSourcePrefix
// user → 'user'
// agent → 'agent'
// daemon, scheduler, gateway, system → 'system'
```

### Well-Known Action Constants

17 predefined constants in `PREFIXED_ACTIONS` (e.g., `USER_GOAL_SUBMIT`, `SYSTEM_WORKITEM_RETRY`, `AGENT_TOOL_CALL`). Gradual migration from unprefixed to prefixed format — `hasPrefixedFormat()` validates the pattern.

## 3.8 LLM Error Domain (ADR-002)

**Source**: `src/infra/llm/llm-error.ts`

### Structured Error Codes

```typescript
type LLMErrorCode =
  | 'rate_limited'       // 429 — recoverable, retry after delay
  | 'context_exceeded'   // context_length — recoverable, switch model
  | 'auth_failed'        // 401, 403 — not recoverable
  | 'content_policy'     // safety filter — not recoverable
  | 'quota_exceeded'     // billing — not recoverable
  | 'server_error'       // 5xx — recoverable, retry
  | 'timeout'            // request timeout — recoverable, retry
  | 'network_error'      // connection failure — recoverable, retry
  | 'model_unavailable'  // model not available — switch model
  | 'unknown';           // unclassified — recoverable by default
```

### Default Retry Behavior

`LLM_ERROR_DEFAULTS` maps each code to `{recoverable, strategy}`:
- `rate_limited` → recoverable, same_model
- `context_exceeded` → recoverable, switch_model
- `auth_failed` → not recoverable, escalate
- `server_error` → recoverable, same_model

### Classification Helpers

- `classifyHttpStatus(status)` — Maps HTTP status codes to LLMErrorCode
- `classifyNetworkError(error)` — Maps ECONNRESET/ETIMEDOUT to network/timeout error codes

Protocol adapters use these to produce `LLMProviderError` instances instead of raw error string matching.
