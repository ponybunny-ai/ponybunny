# 06 - Scheduler & Runtime

## 6.1 Scheduler Core

**Source**: `src/scheduler/core/scheduler.ts`

The `SchedulerCore` is the central execution engine. It processes goals through a tick-based loop, managing work item execution, budget enforcement, and error recovery.

**ADR-001**: SchedulerCore no longer owns elaboration or planning. GoalHarness performs these phases and delegates ready goals to SchedulerCore via `submitGoal()`. SchedulerCore focuses purely on execution infrastructure.

### Configuration

```typescript
SchedulerConfig {
  tickIntervalMs: 1000              // Main loop frequency
  maxConcurrentGoals: 5             // Parallel goal limit
  autoStart: boolean                // Auto-start on goal submission
  executionMode: 'direct' | 'evented'
  deterministicRuntimeEnabled: boolean
  planCompilerEnabled: boolean
  toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred'
  runtimeRollout: {
    shadowModeEnabled: boolean
    canaryPercent: number
    rollbackOnFailure: boolean
    lanePercents: { dryRun, compile, replay }
  }
}
```

### State

```typescript
SchedulerState {
  status: 'idle' | 'running' | 'paused' | 'stopping' | 'stopped'
  activeGoals: string[]
  lanes: Record<LaneId, LaneStatus>
  lastTickAt?: number
  errorCount: number
}

GoalExecutionState {
  goalId: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  currentWorkItemId?: string
  currentRunId?: string
  startedAt?: number
  completedAt?: number
  error?: string
}
```

### Tick Loop

Each tick (every 1000ms):

1. For each active goal, call `processGoal()`
2. Check for blocking escalations
3. Check budget status (warning at 70%, critical at 90%, stop at 100%)
4. Check if all work items are complete → if yes, complete goal
5. Get next ready work item (DAG-ordered, priority-sorted)
6. Select execution lane and LLM model
7. Create Run record and dispatch execution
8. Clean up completed goals

### Event System

SchedulerCore emits events via `on(handler)` / `off(handler)`:

```typescript
interface SchedulerEvent {
  type: string;                      // goal_completed, goal_failed, etc.
  goalId?: string;
  workItemId?: string;
  runId?: string;
  timestamp: number;
  data?: unknown;
}

type SchedulerEventHandler = (event: SchedulerEvent) => void;
```

PostGoalEvaluator (Phase 5) subscribes to `goal_completed` and `goal_failed` events.

## 6.2 8-Phase Autonomous Lifecycle

```
┌─────────┐   ┌──────────────┐   ┌──────────┐   ┌───────────┐
│ 1.Intake │──►│ 2.Elaboration│──►│ 3.Planning│──►│ 4.Execution│
└─────────┘   └──────────────┘   └──────────┘   └─────┬─────┘
                                                       │
    ┌───────────┐   ┌──────────────┐   ┌──────────┐   │
    │ 8.Monitor │◄──│ 7.Publish    │◄──│ 6.Evaluate│◄──┘
    └───────────┘   └──────────────┘   └────┬─────┘
                                            │
                                     ┌──────▼──────┐
                                     │ 5.Verification│
                                     └──────────────┘
```

**ADR-001 Phase Ownership**:

| Phase | Owner | Service |
|-------|-------|---------|
| **Intake** | GoalHarness | (goal creation) |
| **Elaboration** | GoalHarness | ElaborationService (with GlobalKnowledge injection) |
| **Planning** | GoalHarness | PlanningService (WorkItem DAG generation) |
| **Execution** | SchedulerCore | ExecutionService (ReAct loop with LLM + tools) |
| **Verification** | SchedulerCore | QualityGateRunner (deterministic + LLM review) |
| **Evaluation** | SchedulerCore + PostGoalEvaluator | EvaluationService (per-run decisions + post-goal reports) |
| **Publish** | SchedulerCore | PublishService (package artifacts, summaries) |
| **Monitor** | SchedulerCore | MonitorService (metrics, stuck detection, budget alerts) |

## 6.3 Execution Lanes

**Source**: `src/scheduler/lane-selector/lane-selector.ts`

| Lane | Max Concurrency | Selection Criteria |
|------|----------------|-------------------|
| **main** | 1 | Default lane; primary sequential execution path |
| **subagent** | 3 | Parallelizable subtasks, small independent items, analysis/doc type |
| **cron** | 2 | Scheduled or recurring tasks, cron-configured agents |
| **session** | 1 | Interactive sessions, long-running tasks, XL effort items |

### Selection Priority

1. **Explicit**: `workItem.context.lane` set directly
2. **Session**: Interactive, long-running, XL effort, or `goal.context.sessionRequired`
3. **Cron**: Scheduled, recurring, or `goal.context.cronJob`
4. **Subagent**: Parallelizable, delegatable, no dependencies, and lane has capacity
5. **Default**: Main lane

## 6.4 Model Selection

**Source**: `src/scheduler/model-selector/model-selector.ts`

### Complexity Scoring (0-100)

Weighted analysis of work item attributes:

| Factor | Weight | Scoring |
|--------|--------|---------|
| Description length | 40% | <100 chars→20, <500→50, <1000→75, ≥1000→100 |
| Success criteria count | 30% | ≤1→20, ≤3→50, ≤5→75, >5→100 |
| Priority | 20% | Normalized 0-100 |
| Budget tokens | 10% | <10k→20, <50k→50, <100k→75, ≥100k→100 |

### Tier Mapping

| Score | Tier | Default Primary | Default Fallbacks |
|-------|------|----------------|-------------------|
| ≤35 | simple | Claude Haiku | GPT-4o-mini |
| 36-65 | medium | Claude Sonnet | GPT-4o |
| ≥66 | complex | Claude Opus | GPT-4-turbo |

### Selection Result

```typescript
ModelSelectionResult {
  model: string
  tier: 'simple' | 'medium' | 'complex'
  complexityScore: { score, factors, weights }
  reasoning: string
}
```

## 6.5 Budget Tracking

**Source**: `src/scheduler/budget-tracker/budget-tracker.ts`

### Three Budget Dimensions

| Dimension | Goal Fields | Tracking |
|-----------|------------|----------|
| **Tokens** | budget_tokens / spent_tokens | Per-run token counting |
| **Time** | budget_time_minutes / spent_time_minutes | Execution wall-clock time |
| **Cost** | budget_cost_usd / spent_cost_usd | Provider-reported cost |

### Warning Thresholds

| Level | Threshold | Action |
|-------|-----------|--------|
| `none` | <70% | Normal operation |
| `warning` | 70-90% | Emit `budget.warning` event |
| `critical` | 90-100% | Emit `budget.warning` (critical level) |
| `exceeded` | >100% | Emit `budget.exceeded`, pause goal, create escalation |

### Budget Projection

`willExceedBudget(goal, estimatedTokens, estimatedCost)` — checks if a planned execution would exceed limits before starting.

## 6.6 Retry Handler

**Source**: `src/scheduler/retry-handler/retry-handler.ts`

### Decision Flow

```
1. Check max retries exceeded → escalate (no retry)
2. Check error.recoverable → if false, no retry
3. Match against error patterns → use pattern strategy
4. Check error.suggestedAction → use as fallback
5. Default: retry with same model (for recoverable errors)
```

### Error Pattern Matching

| Pattern | Recoverable | Strategy |
|---------|------------|----------|
| rate_limit, 429, timeout, ECONNRESET, ETIMEDOUT | Yes | same_model |
| 500, 502, 503, 504 | Yes | same_model |
| context_length, max_tokens, unsupported | Yes | switch_model |
| 401, 403, invalid_api_key | No | escalate |
| content_policy, safety | No | escalate |
| insufficient_quota, billing | No | escalate |

### Retry Backoff

```
delay = min(baseDelay * 2^attempt, maxDelay) + jitter

Defaults:
  baseDelayMs: 1000
  maxDelayMs: 30000
  jitterFactor: 0.2
```

### Retry Decision

```typescript
RetryDecision {
  shouldRetry: boolean
  strategy: 'same_model' | 'switch_model' | 'escalate'
  reason: string
  nextModel?: string
  delayMs?: number
}
```

## 6.7 Quality Gates

**Source**: `src/scheduler/quality-gate-runner/quality-gate-runner.ts`

### Gate Types

| Type | Mechanism | Timeout |
|------|-----------|---------|
| `deterministic` | Shell command execution, check exit code | 60s |
| `llm_review` | LLM-based semantic review | 120s |

### Verification Flow

1. Get gates from `workItem.verification_plan.quality_gates`
2. Execute each gate (up to 3 concurrent)
3. Record `QualityGateResult` per gate
4. Determine outcome:
   - All passed → work item `done`
   - All **required** passed (optional failures ok) → work item `done`
   - Any **required** failed → treat as execution failure

### Result

```typescript
VerificationResult {
  workItemId: string
  runId: string
  allPassed: boolean
  requiredPassed: boolean
  results: QualityGateResult[]
  summary: string           // "X/Y gates passed..."
  totalDurationMs: number
}
```

## 6.8 Work Item Manager

**Source**: `src/scheduler/work-item-manager/work-item-manager.ts`

### DAG Validation

- Detects missing dependencies (referenced IDs that don't exist)
- Detects cycles (prevents infinite loops)
- Returns detailed error reports

### Work Item Ordering

Ready items sorted by: **priority** (descending) → **created_at** (ascending)

### Dependency Resolution

When a work item completes (`done`), the manager checks all blocked/queued items to see if their dependencies are now satisfied, automatically transitioning them to `ready`.

## 6.9 Escalation Handler

**Source**: `src/scheduler/escalation-handler/escalation-handler.ts`

### Blocking Escalation Types

These types halt goal progress until resolved:
- `stuck` — Agent cannot make progress
- `credential` — Missing API keys or auth
- `risk` — High-impact operation requiring approval

### Escalation Flow

```
Trigger (execution failure, budget exceeded, etc.)
  → Create Escalation with full context
  → Mark work item as 'blocked'
  → Emit 'escalation.created' event
  → Wait for human resolution
    → resolution_action: retry | skip | escalate | manual_intervention
  → Resume work item based on resolution
```

## 6.10 ReAct Loop (Execution Engine)

**Source**: `src/autonomy/react-integration.ts`

The Reasoning + Acting (ReAct) loop is the core execution mechanism for work items.

### Configuration

- **Max iterations**: 20
- **Max no-action iterations**: 3
- **Max empty response retries**: 1

### Loop Flow

```
1. Generate system prompt (phase-aware, tool-aware)
2. Classify intent: 'simple_qa' or 'tool_task'
3. If simple_qa → direct LLM call → return result
4. If tool_task → enter loop:
   a. Call LLM with native tool calling
   b. Parse response:
      - Text/thinking → record as thought
      - Task completion marker → break
      - User input request → pause
   c. Execute each tool call:
      - 'complete_task' → mark complete, break
      - Other tools → execute, add result to messages
   d. Iterate until:
      - Task marked complete
      - Max iterations reached
      - User input needed
      - Abort signal received
5. Collect artifacts, build execution log
6. Return ReActCycleResult
```

### ReActCycleResult

```typescript
{
  success: boolean
  error?: string
  tokensUsed: number
  costUsd: number
  actualModel?: string
  endpointId?: string
  artifactIds?: string[]
  log?: string
}
```

## 6.11 Runtime Boundaries

### Execution Boundary

**Source**: `src/runtime/execution-boundary/`

Interface between scheduler and execution engine:

```typescript
ExecutionPort {
  execute(request: ExecutionRequest): Promise<ExecutionResult>
  abort(runId: string): Promise<void>
}

ExecutionRequest {
  runId, goalId, workItemId, workItem, model, laneId, budgetRemaining
}

ExecutionResult {
  runId, success, outcome, tokensUsed, timeSeconds, costUsd, artifacts, error?
}
```

### Tool Boundary

**Source**: `src/runtime/tool-boundary/`

Interface between execution engine and tool system:

```typescript
ToolPort {
  execute(request: ToolRequest): Promise<ToolResult>
}

ToolRequest {
  toolRequestId, runId, workItemId, goalId, toolCallId, toolName, arguments, cwd?
}

ToolResult {
  toolRequestId, runId, workItemId, goalId, toolCallId, toolName, success, output?, error?
}
```

### Runtime Event Bus

**Source**: `src/runtime/event-bus/`

Pub/sub event bus for loose coupling:

```typescript
RuntimeEvent {
  id: string          // UUID
  type: string        // Event type
  workItemId?: string
  goalId?: string
  runId?: string
  source: string      // 'scheduler', 'local-execution-worker', etc.
  timestamp: number
  payload?: unknown
}
```

Key event types:
- `task.ready` — Work item ready for execution (evented mode)
- `execution.started` / `completed` / `failed` — Worker lifecycle

## 6.12 Evented Execution Mode

In evented mode, execution is decoupled from the scheduler tick:

```
Scheduler                     Worker
    │                           │
    │── publish task.ready ────►│
    │   (store checkpoint)      │── execute work item
    │                           │── call LLM + tools
    │                           │── publish execution.completed ──►│
    │◄── claim result ──────────│                                  │
    │── continue phases         │                                  │
```

### Dispatch Checkpoint (stored in run context)

```typescript
evented_dispatch: {
  execution_mode: 'evented'
  lane_id: string
  dispatched_at: number
  result_continuation_applied: boolean
  // Recovery fields:
  orphan_classification?: 'stale_timeout'
  recovery_candidate?: boolean
  replay_candidate?: boolean
  manual_replay?: { replacement_run_id, ... }
}
```

### Result Claim Statuses

| Status | Meaning |
|--------|---------|
| `claimed` | First time claiming — proceed with post-execution |
| `already_applied` | Duplicate result — suppress |
| `suppressed_by_replay` | Replay took authority — suppress original |
| `already_terminal` | Run already completed — suppress |
| `missing_evented_dispatch` | No checkpoint — cannot claim |

### Orphan Recovery

On daemon startup, reconciliation identifies in-flight runs from previous crashes:
- `not_evented_candidate` — Not evented mode, skip
- `already_terminal_in_db` — Already completed/failed
- `maybe_reattachable` — Potentially recoverable
- `likely_orphaned` — Stale, needs manual replay

## 6.13 PostGoalEvaluator (ADR-001 Phase 5)

**Source**: `src/harness/post-goal-evaluator.ts`

Observational evaluation hook that subscribes to SchedulerCore events.

### Lifecycle

- `start()` — Subscribes event handler to SchedulerCore
- `stop()` — Unsubscribes event handler
- Managed by HarnessDaemon (main.ts) and SchedulerDaemon

### Evaluation Flow

```
goal_completed / goal_failed event received
  → Get all work items for goal
  → For each work item:
    → Get latest run (highest run_sequence)
    → Construct synthetic VerificationResult from trigger
    → Call EvaluationService.evaluateRun()
    → Record decision: publish | retry | replan | escalate
  → Produce GoalEvaluationReport
  → Store report (bounded, max 100)
  → Log summary
```

### Design Constraints

- **No side effects**: Reports are observational only
- **Fire-and-forget**: Async errors caught and logged, never rethrown
- **Bounded storage**: Last 100 reports only
- **Unactionable decisions**: `replan` is logged but not implemented

### Report Summary Format

```
[PostGoalEvaluator] Goal <id> evaluated: Xp/Yr/Ze/Wrp/Vs
  p=publish, r=retry, e=escalate, rp=replan, s=skipped
```

## 6.14 Scheduler Metrics

```typescript
SchedulerMetrics {
  totalGoalsProcessed: number
  totalWorkItemsCompleted: number
  totalRunsExecuted: number
  averageWorkItemDurationMs: number
  successRate: number
  currentActiveGoals: number
  currentActiveWorkItems: number
}
```
