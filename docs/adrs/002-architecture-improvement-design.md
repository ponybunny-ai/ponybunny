# PonyBunny 架构改进设计文档
**目标架构 · 一步到位的最佳实践重构方案**

> **文档状态**: verified (all 18 phase items A1-F1 implemented and tested, 2185 tests passing)
> **适用范围**: 全系统架构改进，无历史包袱约束
> **设计原则**: 单一职责、显式合约、类型安全、可观测、可测试
> **所有权**: harness-architect 子 Agent 评审，planner 分解执行

---

## 设计总览

本文档针对架构质量评估报告识别出的所有问题，给出最终期望设计。按子系统组织，每节包含：问题根因 → 目标设计 → 接口定义 → 受影响模块。

改动最大的六个区域：

1. **LLM 服务层**：统一入口 + 结构化错误 + Circuit Breaker
2. **可观测性**：结构化日志 + 指标持久化 + OpenTelemetry Span
3. **内存管理**：ReAct 消息修剪 + 嵌入缓存重构 + 报告持久化
4. **调度器配置**：清理 SchedulerConfig + 统一并发上限
5. **错误边界**：工具超时 + IPC 背压 + 信号唤醒
6. **目录重组**：消灭 `src/autonomy/`，统一执行层归属

---

## 一、LLM 服务层重构

### 1.1 问题根因

- `LLMProviderManager.complete(workload, messages)` 和 `LLMService.getModelForTier(tier)` 是两个独立入口，调用方必须自己判断哪种场景用哪个
- `getLLMProviderManager()` 是全局单例，不可注入，无法隔离测试
- RetryHandler 基于原始错误消息字符串做模式匹配，提供商措辞变化会静默破坏重试策略
- 无 Circuit Breaker，已宕机的提供商仍然承受完整的等待-失败周期
- 各协议适配器的超时实现不一致，无统一保障

### 1.2 目标设计

#### 统一服务接口

```typescript
// src/infra/llm/llm-service.interface.ts

export type LLMWorkload =
  | 'execution'
  | 'planning'
  | 'elaboration'
  | 'evaluation'
  | 'conversation'
  | 'quality-review';

export interface ILLMService {
  /**
   * 主入口：根据 workload 自动选择模型、tier、提供商
   * 内部处理 fallback、retry、circuit breaker
   */
  complete(
    workload: LLMWorkload,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse>;

  /**
   * 显式指定模型（用于 switch_model retry 策略）
   */
  completeWithModel(
    model: string,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse>;

  /**
   * 查询当前各提供商健康状态（用于 debug.snapshot）
   */
  getProviderHealth(): ProviderHealthSnapshot[];
}

export interface LLMCompletionOptions {
  timeoutMs?: number;          // 覆盖默认超时
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
  abortSignal?: AbortSignal;
}

export interface LLMResponse {
  content: string | null;
  tokensUsed: TokenUsage;
  model: string;
  endpointId: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  toolCalls?: ToolCall[];
  thinking?: string;
  latencyMs: number;           // 新增：每次调用延迟，用于 tracing
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  costUsd: number;             // 在此归一化，不再由调用方计算
}
```

#### 结构化 LLM 错误类型

```typescript
// src/infra/llm/llm-error.ts

export type LLMErrorCode =
  | 'rate_limited'           // 429, retry after
  | 'context_exceeded'       // context_length, switch_model
  | 'auth_failed'            // 401, 403 — 不可恢复
  | 'content_policy'         // 安全过滤 — 不可恢复
  | 'quota_exceeded'         // billing — 不可恢复
  | 'server_error'           // 5xx — 可重试
  | 'timeout'                // 超时 — 可重试
  | 'network_error'          // 连接失败 — 可重试
  | 'model_unavailable'      // 模型不可用 — switch_model
  | 'unknown';

export class LLMProviderError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    public readonly provider: string,
    public readonly recoverable: boolean,
    public readonly retryAfterMs?: number,   // rate_limited 场景
    public readonly rawMessage?: string,
    cause?: unknown
  ) {
    super(`[${provider}] ${code}: ${rawMessage ?? ''}`);
    this.name = 'LLMProviderError';
    if (cause) this.cause = cause;
  }
}
```

各协议适配器负责将提供商原始错误转换为 `LLMProviderError`，RetryHandler 接收 `LLMErrorCode`：

```typescript
// src/infra/llm/adapters/anthropic-protocol-adapter.ts (改造)

private mapError(raw: unknown): LLMProviderError {
  if (isAnthropicError(raw)) {
    if (raw.status === 429) {
      return new LLMProviderError(
        'rate_limited', 'anthropic', true,
        raw.headers?.['retry-after'] ? parseInt(raw.headers['retry-after']) * 1000 : undefined,
        raw.message
      );
    }
    if (raw.status === 401 || raw.status === 403) {
      return new LLMProviderError('auth_failed', 'anthropic', false, undefined, raw.message);
    }
    if (raw.error?.type === 'context_length_exceeded') {
      return new LLMProviderError('context_exceeded', 'anthropic', true, undefined, raw.message);
    }
    // ... 完整映射
  }
  return new LLMProviderError('unknown', 'anthropic', true, undefined, String(raw));
}
```

#### Circuit Breaker

```typescript
// src/infra/llm/circuit-breaker.ts

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // 默认 5：连续失败 5 次后打开
  successThreshold: number;      // 默认 2：半开状态成功 2 次后关闭
  cooldownMs: number;            // 默认 60_000：打开后等待 60 秒再尝试
  monitoredErrorCodes: LLMErrorCode[];  // 只统计这些错误码
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private openedAt?: number;

  constructor(
    private readonly providerId: string,
    private readonly config: CircuitBreakerConfig,
    private readonly logger: ILogger
  ) {}

  isCallAllowed(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.openedAt! >= this.config.cooldownMs) {
        this.transitionTo('half-open');
        return true;
      }
      return false;
    }
    // half-open: 允许一次试探
    return true;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }
    this.failureCount = 0;
  }

  recordFailure(code: LLMErrorCode): void {
    if (!this.config.monitoredErrorCodes.includes(code)) return;
    this.failureCount++;
    if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  getStatus(): { state: CircuitState; failureCount: number; openedAt?: number } {
    return { state: this.state, failureCount: this.failureCount, openedAt: this.openedAt };
  }

  private transitionTo(next: CircuitState): void {
    this.logger.info({ event: 'circuit_breaker_transition', provider: this.providerId, from: this.state, to: next });
    this.state = next;
    if (next === 'open') this.openedAt = Date.now();
    if (next === 'closed') { this.failureCount = 0; this.successCount = 0; }
    if (next === 'half-open') this.successCount = 0;
  }
}
```

#### UnifiedLLMService（取代两个入口）

```typescript
// src/infra/llm/unified-llm-service.ts

export class UnifiedLLMService implements ILLMService {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly providerManager: ProviderManager,   // 内部，不暴露
    private readonly workloadConfig: WorkloadConfig,
    private readonly logger: ILogger,
    private readonly tracer: ITracer
  ) {
    // 为每个 endpoint 初始化 circuit breaker
    for (const endpointId of providerManager.getEndpointIds()) {
      this.breakers.set(endpointId, new CircuitBreaker(endpointId, DEFAULT_CB_CONFIG, logger));
    }
  }

  async complete(workload: LLMWorkload, messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse> {
    const model = this.workloadConfig.resolveModel(workload);
    return this.completeWithModel(model, messages, options);
  }

  async completeWithModel(model: string, messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse> {
    const endpoints = this.providerManager.getEndpointsForModel(model);
    const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (const endpoint of endpoints) {
      const breaker = this.breakers.get(endpoint.id)!;
      if (!breaker.isCallAllowed()) {
        this.logger.warn({ event: 'circuit_open_skip', endpoint: endpoint.id, model });
        continue;
      }

      const span = this.tracer.startSpan('llm.complete', { model, endpoint: endpoint.id, workload: options?.workload });
      try {
        const response = await Promise.race([
          endpoint.adapter.complete(messages, options),
          this.timeout(timeout, endpoint.id)
        ]);
        breaker.recordSuccess();
        span.end({ status: 'ok', tokens: response.tokensUsed.total });
        return response;
      } catch (err) {
        const llmErr = err instanceof LLMProviderError ? err : new LLMProviderError('unknown', endpoint.id, true, undefined, String(err));
        breaker.recordFailure(llmErr.code);
        span.end({ status: 'error', errorCode: llmErr.code });

        if (!llmErr.recoverable) throw llmErr;   // 不可恢复直接抛出，不尝试下一个 endpoint
        this.logger.warn({ event: 'llm_endpoint_failed', endpoint: endpoint.id, code: llmErr.code, willTryNext: true });
        // 继续尝试下一个 endpoint
      }
    }
    throw new LLMProviderError('unknown', model, false, undefined, 'All endpoints exhausted');
  }

  getProviderHealth(): ProviderHealthSnapshot[] {
    return Array.from(this.breakers.entries()).map(([id, breaker]) => ({
      endpointId: id,
      ...breaker.getStatus()
    }));
  }

  private timeout(ms: number, endpointId: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new LLMProviderError('timeout', endpointId, true)), ms)
    );
  }
}
```

#### 模型复杂度评分改进

```typescript
// src/scheduler/model-selector/complexity-scorer.ts

// 移除：description_length (40%) + priority (20%)
// 新增：item_type + estimated_effort + dependency_count

export function scoreComplexity(workItem: WorkItem): ComplexityScore {
  const factors: ComplexityFactors = {
    // item_type 贡献 35%：refactor/analysis 比 doc 复杂
    itemType: scoreItemType(workItem.item_type) * 0.35,
    // estimated_effort 贡献 35%：S=20, M=50, L=75, XL=100
    estimatedEffort: EFFORT_SCORES[workItem.estimated_effort] * 0.35,
    // dependency_count 贡献 20%：依赖多 = 集成复杂度高
    dependencyCount: Math.min(workItem.dependencies.length / 5, 1) * 100 * 0.20,
    // success_criteria_count 贡献 10%（保留，但降低权重）
    successCriteriaCount: Math.min(workItem.verification_plan?.quality_gates?.length ?? 0, 5) / 5 * 100 * 0.10,
  };
  const score = Object.values(factors).reduce((a, b) => a + b, 0);
  return { score, factors, tier: scoreTier(score) };
}

const EFFORT_SCORES: Record<EstimatedEffort, number> = { S: 20, M: 50, L: 75, XL: 100 };

function scoreItemType(type: WorkItemType): number {
  const scores: Record<WorkItemType, number> = {
    doc: 20, test: 40, analysis: 60, code: 70, refactor: 90
  };
  return scores[type] ?? 50;
}

// 移除 priority 因子（优先级和计算复杂度无关）
// 移除 budget_tokens 因子（预算是约束不是复杂度信号）
```

#### 受影响文件

```
删除:  src/infra/llm/provider-manager.ts（合并入 UnifiedLLMService 内部）
改造:  src/infra/llm/adapters/*.ts（错误类型化）
新增:  src/infra/llm/llm-service.interface.ts
新增:  src/infra/llm/unified-llm-service.ts
新增:  src/infra/llm/circuit-breaker.ts
新增:  src/infra/llm/llm-error.ts
改造:  src/scheduler/retry-handler/retry-handler.ts（接收 LLMErrorCode）
改造:  src/scheduler/model-selector/complexity-scorer.ts
删除:  src/infra/llm/llm-service.ts（功能并入 UnifiedLLMService）
```

---

## 二、可观测性系统重构

### 2.1 问题根因

- `SchedulerMetrics` 是内存瞬态值，进程重启归零，无时间趋势
- 无结构化日志，`goalId/runId` 等 correlation field 靠 grep
- 无分布式追踪（traces），无法看到单次 Goal 的端到端延迟分解
- Debug 服务器与主系统数据访问方式不明确

### 2.2 目标设计

#### 结构化日志（Logger Interface）

```typescript
// src/infra/observability/logger.ts

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  goalId?: string;
  workItemId?: string;
  runId?: string;
  sessionId?: string;
  agentType?: string;
  model?: string;
  endpointId?: string;
  // 其他结构化字段按需添加
  [key: string]: unknown;
}

export interface ILogger {
  debug(ctx: LogContext, msg: string): void;
  info(ctx: LogContext, msg: string): void;
  warn(ctx: LogContext, msg: string): void;
  error(ctx: LogContext, msg: string, err?: Error): void;
  child(bindCtx: LogContext): ILogger;    // 创建带固定上下文的子 logger
}

// 实现：JSON Lines 格式，每行一个 JSON 对象
// 输出到 stdout，由外部（systemd journald / Docker log driver / file rotation）处理
export class PinoLogger implements ILogger {
  constructor(private readonly pino: import('pino').Logger) {}

  info(ctx: LogContext, msg: string): void {
    this.pino.info(ctx, msg);
  }
  // ... 其他方法

  child(bindCtx: LogContext): ILogger {
    return new PinoLogger(this.pino.child(bindCtx));
  }
}
```

**每个服务在构造时接收 logger，不在内部创建**：

```typescript
// 之前（错误）：直接 console.log
if (isPonyBunnyDebugEnabled()) { console.log('[Scheduler] tick started'); }

// 之后（正确）：结构化，可过滤，可聚合
this.logger.debug({ event: 'scheduler_tick', activeGoals: this.state.activeGoals.length }, 'tick started');
```

日志格式（每行一个 JSON）：
```json
{"level":"info","time":1711699200000,"goalId":"g-123","workItemId":"wi-456","runId":"r-789","event":"react_iteration","iteration":3,"tokensSoFar":1240,"msg":"ReAct loop iteration"}
```

#### 指标系统（持久化 + 时间序列）

```typescript
// src/infra/observability/metrics.ts

export interface IMetricsRecorder {
  // 计数器（跨重启累计）
  increment(name: MetricName, labels?: Record<string, string>): void;
  // 直方图（延迟分布）
  recordDuration(name: MetricName, durationMs: number, labels?: Record<string, string>): void;
  // 仪表盘（瞬时值）
  gauge(name: MetricName, value: number, labels?: Record<string, string>): void;
}

export type MetricName =
  | 'goal.completed'
  | 'goal.failed'
  | 'workitem.completed'
  | 'workitem.failed'
  | 'run.success'
  | 'run.failure'
  | 'llm.call.duration'
  | 'llm.call.tokens'
  | 'llm.call.cost_usd'
  | 'tool.execution.duration'
  | 'quality_gate.passed'
  | 'quality_gate.failed'
  | 'escalation.created'
  | 'circuit_breaker.opened'
  | 'retry.attempted';
```

**持久化存储：SQLite `metrics` 表**

```sql
-- 新增 schema-metrics.sql
CREATE TABLE metric_counters (
  name       TEXT NOT NULL,
  labels     TEXT NOT NULL DEFAULT '{}',  -- JSON
  value      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (name, labels)
);

CREATE TABLE metric_samples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  labels     TEXT NOT NULL DEFAULT '{}',
  value      REAL NOT NULL,
  recorded_at INTEGER NOT NULL
);

-- 保留最近 7 天的 samples（由 cron agent 清理）
CREATE INDEX idx_metric_samples_time ON metric_samples(name, recorded_at DESC);
```

`MetricsRecorder` 的 `increment` 直接 UPSERT `metric_counters`，`recordDuration` INSERT 到 `metric_samples`（批量写，避免高频单条写）。

新增 RPC 方法：
```
metrics.counters   read  {}                           { counters: MetricCounter[] }
metrics.histogram  read  { name, since, buckets? }   { p50, p95, p99, samples }
```

#### OpenTelemetry Tracer Interface

```typescript
// src/infra/observability/tracer.ts

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface ISpan {
  setAttributes(attrs: SpanAttributes): void;
  addEvent(name: string, attrs?: SpanAttributes): void;
  end(attrs?: SpanAttributes & { status?: 'ok' | 'error' }): void;
}

export interface ITracer {
  startSpan(name: string, attrs?: SpanAttributes): ISpan;
  /**
   * 在现有 span 上下文内执行，自动开始/结束 span
   */
  withSpan<T>(name: string, attrs: SpanAttributes, fn: (span: ISpan) => Promise<T>): Promise<T>;
}
```

**Span 埋点位置（关键路径）**：

```
GoalHarness.elaboratePlanDelegate()       → span: harness.elaborate_and_plan
  ElaborationService.elaborate()          → span: harness.elaborate
  PlanningService.plan()                  → span: harness.plan
SchedulerCore.executeWorkItem()           → span: scheduler.execute_work_item
  ReAct 单次 iteration                   → span: react.iteration (包含 iteration 编号)
    LLM 单次调用                          → span: llm.complete (包含 model, endpoint, tokens)
    单次工具调用                          → span: tool.execute (包含 toolName, riskLevel)
  QualityGateRunner.runGate()            → span: quality_gate.run (包含 gateType, required)
PostGoalEvaluator.onGoalEvent()          → span: evaluator.post_goal
```

实现选项：

- **开发/轻量模式**：`NoopTracer`（零开销占位符）+ 关键 span 写入 `runtime_events` 表（已有）
- **生产/分析模式**：`OTLPTracer`（`@opentelemetry/sdk-node`）向 Jaeger/Tempo/Honeycomb 导出

默认使用 NoopTracer，通过环境变量 `PONYBUNNY_OTLP_ENDPOINT` 启用真实导出：

```typescript
// src/infra/observability/tracer-factory.ts
export function createTracer(): ITracer {
  if (process.env.PONYBUNNY_OTLP_ENDPOINT) {
    return new OTLPTracer(process.env.PONYBUNNY_OTLP_ENDPOINT);
  }
  return new RuntimeEventTracer(runtimeEventBus);  // 轻量：将 span 写入 runtime_events
}
```

#### Debug Server 数据访问明确化

Debug Server 通过 **Gateway WebSocket（只读连接）** 获取数据，不直接访问 SQLite：

```typescript
// debug-server/server/src/gateway-client.ts

// Debug Server 作为普通 WebSocket 客户端连接到 Gateway
// 使用 local auth（自动 admin）
// 订阅所有事件，用 debug.snapshot / debug.goals / metrics.counters 等 RPC 拉取数据
```

这消除了 debug server 与 Scheduler 的 SQLite 写-读竞争，也让 debug server 可以独立于主进程运行。

#### 受影响文件

```
新增:  src/infra/observability/logger.ts
新增:  src/infra/observability/metrics.ts
新增:  src/infra/observability/metrics-recorder.ts（SQLite 实现）
新增:  src/infra/observability/tracer.ts
新增:  src/infra/observability/tracer-factory.ts
新增:  src/infra/observability/noop-tracer.ts
新增:  src/infra/observability/runtime-event-tracer.ts
新增:  src/infra/persistence/metrics-repository.ts
新增:  db/schema-metrics.sql
删除:  src/infra/config/debug-flags.ts（console.log 全部替换）
改造:  所有服务构造函数（注入 ILogger、IMetricsRecorder、ITracer）
新增:  src/gateway/rpc/metrics-handler.ts（metrics.counters / metrics.histogram）
```

---

## 三、内存管理重构

### 3.1 GoalEvaluationReport 持久化

**问题**：GoalEvaluationReport 存在进程内存中（max 100），重启丢失，与"Auditability is mandatory"矛盾。

**目标设计**：

```sql
-- db/schema-evaluation.sql
CREATE TABLE goal_evaluation_reports (
  id              TEXT PRIMARY KEY,          -- UUID
  goal_id         TEXT NOT NULL,
  trigger         TEXT NOT NULL,             -- 'goal_completed' | 'goal_failed'
  evaluated_at    INTEGER NOT NULL,
  summary_json    TEXT NOT NULL,             -- JSON GoalEvaluationSummary
  work_items_json TEXT NOT NULL,             -- JSON WorkItemEvaluation[]
  FOREIGN KEY(goal_id) REFERENCES goals(id)
);

CREATE INDEX idx_eval_reports_goal ON goal_evaluation_reports(goal_id);
CREATE INDEX idx_eval_reports_time ON goal_evaluation_reports(evaluated_at DESC);
```

PostGoalEvaluator 修改：

```typescript
// src/harness/post-goal-evaluator.ts（改造）

export class PostGoalEvaluator {
  constructor(
    private readonly evalRepo: IEvaluationReportRepository,   // 替代内存数组
    private readonly globalKnowledge: IGlobalKnowledgeService, // 飞轮连接
    private readonly logger: ILogger
  ) {}

  private async handleGoalEvent(event: SchedulerEvent): Promise<void> {
    try {
      const report = await this.buildReport(event);

      // 持久化（原来是写内存数组）
      await this.evalRepo.save(report);

      // 飞轮连接（原来缺失的一步）
      const contextPack = await this.contextPackRepo.getLatestForGoal(event.goalId!);
      if (contextPack) {
        await this.globalKnowledge.extractFromContextPack(contextPack);
      }

      this.logger.info(
        { goalId: event.goalId, event: 'post_goal_evaluated', summary: report.summary },
        `Goal evaluated: ${report.summary.publish}p/${report.summary.retry}r/${report.summary.escalate}e`
      );
    } catch (err) {
      // fire-and-forget 原则保持
      this.logger.error({ goalId: event.goalId, event: 'post_goal_evaluator_error' }, 'PostGoalEvaluator failed', err as Error);
    }
  }
}
```

新增 RPC：
```
evaluation.list   read   { goalId?, trigger?, limit?, since? }   { reports: GoalEvaluationReport[] }
evaluation.get    read   { goalId }                               GoalEvaluationReport | null
```

### 3.2 SchedulerMetrics 持久化累计值

**问题**：`totalGoalsProcessed` 等计数器重启归零。

**目标设计**：使用 `meta` 表（已有）存储累计计数器，启动时恢复：

```typescript
// src/scheduler/core/persistent-metrics.ts

export class PersistentSchedulerMetrics {
  private inMemory: SchedulerCounters = { goalsProcessed: 0, runsExecuted: 0, workItemsCompleted: 0 };

  constructor(private readonly meta: IMetaRepository) {}

  async restore(): Promise<void> {
    const saved = await this.meta.get('scheduler.metrics');
    if (saved) this.inMemory = JSON.parse(saved);
  }

  increment(key: keyof SchedulerCounters): void {
    this.inMemory[key]++;
    // 批量写，不是每次 increment 都写 SQLite
  }

  async flush(): Promise<void> {
    await this.meta.set('scheduler.metrics', JSON.stringify(this.inMemory));
  }
}

// HarnessDaemon 在 stop() 时调用 flush()
// 也可以每 60 秒定时 flush 一次（用 setInterval 在 HarnessDaemon 中管理）
```

### 3.3 ReAct 循环消息修剪

**问题**：20 次迭代 × 工具大量输出，消息数组无上界增长。

**目标设计**：

```typescript
// src/runtime/react/message-window.ts

export interface MessageWindowConfig {
  maxTotalTokens: number;        // 默认 80_000（留 20k 给输出）
  keepSystemPrompt: boolean;     // 系统提示始终保留
  keepLastN: number;             // 始终保留最近 N 轮完整消息（默认 4）
  summarizeThreshold: number;    // 超过此 token 数后触发摘要（默认 60_000）
}

export class MessageWindow {
  private messages: LLMMessage[] = [];
  private estimatedTokens = 0;

  constructor(
    private readonly config: MessageWindowConfig,
    private readonly summarizer: ILLMService,   // 用 'planning' workload 做摘要
    private readonly logger: ILogger
  ) {}

  async push(message: LLMMessage): Promise<void> {
    this.messages.push(message);
    this.estimatedTokens += estimateTokens(message);

    if (this.estimatedTokens > this.config.summarizeThreshold) {
      await this.compact();
    }
  }

  getMessages(): LLMMessage[] {
    return this.messages;
  }

  private async compact(): Promise<void> {
    // 保留：系统提示 + 最近 keepLastN 轮
    const systemMsg = this.messages.find(m => m.role === 'system');
    const recentMsgs = this.messages.slice(-this.config.keepLastN * 2);
    const middleMsgs = this.messages.slice(
      systemMsg ? 1 : 0,
      this.messages.length - this.config.keepLastN * 2
    );

    if (middleMsgs.length < 2) return;  // 没什么可压缩的

    // 用 LLM 摘要中间部分
    const summaryResponse = await this.summarizer.complete('planning', [{
      role: 'user',
      content: `以下是一段工具调用历史，请摘要为 200 字以内的关键信息：\n\n${JSON.stringify(middleMsgs)}`
    }]);

    const summaryMsg: LLMMessage = {
      role: 'system',
      content: `[COMPACTED HISTORY] ${summaryResponse.content}`
    };

    this.messages = [
      ...(systemMsg ? [systemMsg] : []),
      summaryMsg,
      ...recentMsgs
    ];
    this.estimatedTokens = this.messages.reduce((sum, m) => sum + estimateTokens(m), 0);
    this.logger.info({ event: 'react_message_compacted', tokensBefore: this.config.summarizeThreshold, tokensAfter: this.estimatedTokens }, 'Message window compacted');
  }
}
```

### 3.4 向量嵌入缓存改为内存 LRU

**问题**：`embedding_cache` 表的 LRU 需要在每次**读取**时写 `last_accessed_at` 和 `access_count`，读操作引发写事务。

**目标设计**：

```typescript
// src/infra/persistence/embedding-cache.ts（重构）

import { LRUCache } from 'lru-cache';   // 已是 Node.js 生态标准库

export class EmbeddingCache {
  // 内存 LRU：快速命中，无写事务
  private readonly memCache: LRUCache<string, Float32Array>;

  constructor(
    private readonly sqliteRepo: ISqliteEmbeddingRepository,
    maxEntries = 500
  ) {
    this.memCache = new LRUCache({ max: maxEntries });
  }

  async get(key: string, model: string): Promise<Float32Array | null> {
    const cacheKey = `${model}::${key}`;

    // 先查内存
    const hit = this.memCache.get(cacheKey);
    if (hit) return hit;

    // 再查 SQLite（仅冷启动后的预热查询会到这里）
    const stored = await this.sqliteRepo.get(key, model);
    if (stored) {
      this.memCache.set(cacheKey, stored.embedding);
      return stored.embedding;
    }
    return null;
  }

  async set(key: string, model: string, embedding: Float32Array): Promise<void> {
    const cacheKey = `${model}::${key}`;
    this.memCache.set(cacheKey, embedding);
    // 异步写 SQLite（持久化用），不阻塞返回
    this.sqliteRepo.set(key, model, embedding).catch(err => {
      this.logger.warn({ event: 'embedding_cache_persist_failed', key }, 'Failed to persist embedding');
    });
  }

  // SQLite 表简化：去掉 last_accessed_at 和 access_count
  // 只保留：cache_key, embedding_model, embedding, created_at
}
```

### 3.5 SQLite 迁移系统

**问题**：`schema.sql` / `schema-memory.sql` / `schema-migration-v2.sql` 是有机生长的产物，无版本化管理。

**目标设计**：引入 `better-sqlite3-migrations` 或自研轻量迁移：

```typescript
// src/infra/persistence/migrations/index.ts

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: readFileSync('db/schema.sql', 'utf-8'),
  },
  {
    version: 2,
    name: 'add_allowed_actions_to_goals',
    up: `ALTER TABLE goals ADD COLUMN allowed_actions TEXT;`,
  },
  {
    version: 3,
    name: 'add_memory_schema',
    up: readFileSync('db/schema-memory.sql', 'utf-8'),
  },
  {
    version: 4,
    name: 'add_global_knowledge',
    up: readFileSync('db/schema-knowledge.sql', 'utf-8'),
  },
  {
    version: 5,
    name: 'add_goal_evaluation_reports',
    up: readFileSync('db/schema-evaluation.sql', 'utf-8'),
  },
  {
    version: 6,
    name: 'add_metrics_tables',
    up: readFileSync('db/schema-metrics.sql', 'utf-8'),
  },
  {
    version: 7,
    name: 'simplify_embedding_cache',
    up: `
      CREATE TABLE embedding_cache_v2 (
        cache_key TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (cache_key, embedding_model)
      );
      INSERT INTO embedding_cache_v2 SELECT cache_key, embedding_model, embedding, created_at FROM embedding_cache;
      DROP TABLE embedding_cache;
      ALTER TABLE embedding_cache_v2 RENAME TO embedding_cache;
    `
  }
];

// src/infra/persistence/migrator.ts
export class DatabaseMigrator {
  constructor(private readonly db: Database) {}

  run(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`);

    const applied = new Set(
      this.db.prepare('SELECT version FROM schema_migrations').all().map((r: any) => r.version)
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.db.transaction(() => {
        this.db.exec(migration.up);
        this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(
          migration.version, migration.name, Date.now()
        );
      })();
    }
  }
}
```

删除独立的 `schema-migration-v2.sql`，所有 schema 变更通过 migrations 数组管理。

#### 受影响文件

```
新增:  src/infra/persistence/migrations/index.ts
新增:  src/infra/persistence/migrator.ts
新增:  src/infra/persistence/evaluation-report-repository.ts
新增:  src/infra/persistence/metrics-repository.ts
新增:  db/schema-evaluation.sql
新增:  db/schema-metrics.sql
新增:  db/schema-knowledge.sql（从 global_knowledge 表定义独立出来）
改造:  src/infra/persistence/embedding-cache.ts（内存 LRU）
改造:  src/harness/post-goal-evaluator.ts（持久化 + GlobalKnowledge 写入）
改造:  src/runtime/react/react-integration.ts（使用 MessageWindow）
新增:  src/runtime/react/message-window.ts
改造:  src/scheduler/core/scheduler.ts（使用 PersistentSchedulerMetrics）
新增:  src/scheduler/core/persistent-metrics.ts
删除:  db/schema-migration-v2.sql
```

---

## 四、调度器配置清理

### 4.1 SchedulerConfig 瘦身

**问题**：混合了执行参数、工具路由历史模式、金丝雀流量管理、未解释的功能开关。

**目标设计**：

```typescript
// src/scheduler/core/scheduler-config.ts（重构）

export interface SchedulerConfig {
  // 执行参数
  tickIntervalMs: number;            // 默认 1000

  // 工具路由：去掉 'legacy'，只保留 2 个有意义的选项
  toolRoutingMode: 'system_preferred' | 'model_preferred';
  // system_preferred: 优先使用系统内置工具
  // model_preferred: 优先使用 LLM 指定的工具

  // 执行模式
  executionMode: 'direct' | 'evented';
}

// 移除：
// - maxConcurrentGoals（由 HarnessDaemon 统一控制，见 4.2）
// - runtimeRollout（local-first 工具不需要金丝雀发布）
// - planCompilerEnabled（未使用或功能不明确，直接移除）
// - deterministicRuntimeEnabled（重命名为 executionMode: 'evented'）
// - autoStart（无歧义的默认行为，不需要配置项）
```

### 4.2 统一并发上限

**问题**：HarnessDaemon `maxConcurrentGoals: 2` 和 SchedulerCore `maxConcurrentGoals: 5` 独立存在，关系不明确。

**目标设计**：

```typescript
// src/harness/harness-daemon.ts

export interface HarnessDaemonConfig {
  pollingIntervalMs: number;         // 默认 5000
  maxConcurrentGoals: number;        // 唯一的并发上限，默认 2

  // 新增：目标提交时触发唤醒（见 4.3）
  wakeSignalEnabled: boolean;        // 默认 true
}

// SchedulerCore 移除 maxConcurrentGoals 配置项
// HarnessDaemon 是唯一的并发门控：
// - 它通过 activeGoalCount 控制进入 GoalHarness 的 Goal 数量
// - SchedulerCore 只处理 GoalHarness 已批准的 Goal，不需要自己再限制
```

### 4.3 Goal 提交触发 HarnessDaemon 唤醒

**问题**：HarnessDaemon 5 秒轮询导致 Goal 提交后最多等待 5 秒才被处理。

**目标设计**：

```typescript
// src/harness/harness-daemon.ts（增加唤醒机制）

export class HarnessDaemon {
  private wakeSignal: (() => void) | null = null;

  /** Gateway 提交 Goal 后立即调用此方法 */
  wake(): void {
    if (this.wakeSignal) {
      this.wakeSignal();
    }
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      await this.processPendingGoals();

      // 等待下次轮询或唤醒信号，取先到者
      await Promise.race([
        sleep(this.config.pollingIntervalMs),
        new Promise<void>(resolve => { this.wakeSignal = resolve; })
      ]);
      this.wakeSignal = null;
    }
  }
}

// Gateway 的 submit_goal IPC handler：
// after forwarding to scheduler → harnessDaemon.wake()
```

这样 Goal 提交后立即被处理，5 秒轮询只是保底机制。

#### 受影响文件

```
改造:  src/scheduler/core/scheduler-config.ts（瘦身）
改造:  src/harness/harness-daemon.ts（统一并发上限 + 唤醒机制）
改造:  src/scheduler/core/scheduler.ts（移除 maxConcurrentGoals）
改造:  src/gateway/rpc/goal-handler.ts（触发 harnessDaemon.wake()）
```

---

## 五、错误边界加固

### 5.1 工具执行超时

**问题**：`execute_command` 等工具无超时保护，Shell 命令可以无限阻塞 ReAct 循环。

**目标设计**：

```typescript
// src/runtime/tool-boundary/tool-executor.ts

export interface ToolExecutionConfig {
  defaultTimeoutMs: number;       // 默认 30_000（30秒）
  riskLevelTimeouts: {
    safe: number;                 // 10_000
    moderate: number;             // 30_000
    dangerous: number;            // 60_000（shell 命令给更多时间，但有上限）
    critical: number;             // 15_000（系统命令应该快，超时是异常）
  };
}

export class ToolExecutor implements ToolPort {
  async execute(request: ToolRequest): Promise<ToolResult> {
    const tool = this.registry.getTool(request.toolName);
    if (!tool) {
      return { ...request, success: false, error: `Unknown tool: ${request.toolName}` };
    }

    const timeoutMs = this.config.riskLevelTimeouts[tool.riskLevel] ?? this.config.defaultTimeoutMs;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const span = this.tracer.startSpan('tool.execute', {
      toolName: request.toolName,
      riskLevel: tool.riskLevel,
      goalId: request.goalId
    });

    try {
      const result = await tool.execute(request.arguments, {
        ...request,
        abortSignal: abortController.signal
      });
      span.end({ status: 'ok' });
      return { ...request, success: true, output: result };
    } catch (err) {
      const isTimeout = abortController.signal.aborted;
      span.end({ status: 'error', isTimeout });
      this.logger.warn({ ...request, event: 'tool_execution_failed', isTimeout }, `Tool ${request.toolName} failed`);
      return {
        ...request,
        success: false,
        error: isTimeout ? `Tool execution timed out after ${timeoutMs}ms` : String(err)
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

### 5.2 IPC 消息背压

**问题**：IPC buffer 满时（1000 条）静默丢弃消息，无通知机制。

**目标设计**：

```typescript
// src/ipc/ipc-client.ts（改造）

export interface IPCClientConfig {
  bufferMaxSize: number;             // 默认 1000
  backpressureThreshold: number;     // 默认 800（80%），触发警告
  dropPolicy: 'oldest' | 'newest' | 'throw';  // 默认 'oldest'
}

export class IPCClient {
  private buffer: IPCMessage[] = [];

  private enqueue(message: IPCMessage): void {
    if (this.buffer.length >= this.config.bufferMaxSize) {
      const dropped = this.config.dropPolicy === 'oldest'
        ? this.buffer.shift()!
        : (this.config.dropPolicy === 'newest' ? message : null);

      if (dropped) {
        // 不再静默丢弃，写入可查询的记录
        this.logger.warn({
          event: 'ipc_buffer_drop',
          droppedType: (dropped as IPCMessage).type,
          bufferSize: this.buffer.length
        }, 'IPC buffer full, message dropped');
        this.metrics.increment('ipc.message.dropped', { type: (dropped as IPCMessage).type });
      }

      if (this.config.dropPolicy === 'throw') {
        throw new Error(`IPC buffer full (${this.config.bufferMaxSize} messages)`);
      }
    }

    if (this.buffer.length >= this.config.backpressureThreshold) {
      this.logger.warn({ event: 'ipc_buffer_pressure', bufferSize: this.buffer.length }, 'IPC buffer approaching limit');
    }

    if (this.config.dropPolicy !== 'newest') {
      this.buffer.push(message);
    }
  }
}
```

### 5.3 Gateway 本地鉴权策略明确化

**问题**：本地连接自动获得 admin 权限，但安全假设未文档化，无关闭选项。

**目标设计**：

```typescript
// src/gateway/auth/auth-config.ts

export interface GatewayAuthConfig {
  /**
   * 本地连接（127.0.0.1 / ::1）自动授予的权限级别
   *
   * - 'admin'（默认）：开发/个人使用，无需配置客户端认证
   * - 'none'：所有连接均需完整鉴权（生产/多用户/容器环境）
   *
   * 安全假设：'admin' 模式假设运行环境是单用户可信机器。
   * 在 Docker / CI / 共享服务器场景请设置为 'none'。
   */
  localConnectionPolicy: 'admin' | 'none';
}
```

在 `ponybunny.json` schema 中暴露此配置，文档化其安全假设，`pb init` 时根据环境检测给出合适的默认值（检测到 Docker 环境时建议 `none`）。

### 5.4 ReAct 无进展检测精确化

**问题**：`max no-action iterations: 3` 的检测依据不明确。

**目标设计**：

```typescript
// src/runtime/react/progress-detector.ts

export class ProgressDetector {
  private noActionCount = 0;
  private lastToolCallCount = 0;
  private lastContentHash = '';

  /**
   * 每次 LLM 响应后调用，返回是否应该中止循环
   */
  evaluate(response: LLMResponse, config: ProgressConfig): ProgressAssessment {
    const hasToolCalls = (response.toolCalls?.length ?? 0) > 0;
    const contentHash = hashString(response.content ?? '');
    const isRepeatedContent = contentHash === this.lastContentHash && this.lastContentHash !== '';

    if (!hasToolCalls && !response.content) {
      this.noActionCount++;
    } else {
      this.noActionCount = 0;
    }
    this.lastContentHash = contentHash;

    if (this.noActionCount >= config.maxNoActionIterations) {
      return { shouldAbort: true, reason: 'no_action', detail: `${this.noActionCount} consecutive empty responses` };
    }
    if (isRepeatedContent && !hasToolCalls) {
      return { shouldAbort: true, reason: 'stuck_loop', detail: 'Repeated identical response without tool calls' };
    }
    return { shouldAbort: false };
  }
}

export interface ProgressAssessment {
  shouldAbort: boolean;
  reason?: 'no_action' | 'stuck_loop' | 'max_iterations';
  detail?: string;
}
```

#### 受影响文件

```
改造:  src/runtime/tool-boundary/tool-executor.ts（超时机制）
改造:  src/ipc/ipc-client.ts（背压 + 日志）
改造:  src/gateway/auth/auth-manager.ts（可配置的本地鉴权策略）
新增:  src/gateway/auth/auth-config.ts
改造:  src/runtime/react/react-integration.ts（使用 ProgressDetector）
新增:  src/runtime/react/progress-detector.ts
改造:  docs/schemas/ponybunny.schema.json（新增 localConnectionPolicy）
```

---

## 六、目录结构重组

### 6.1 消灭 `src/autonomy/`

**问题**：`react-integration.ts` 是系统核心执行引擎，放在 `src/autonomy/` 导致重要性被低估；`daemon-event-emitter.ts` 是 Phase 4 删除 AutonomyDaemon 后的遗留物。

**目标结构**：

```
src/
├── harness/                   # ADR-001 合约层（不变）
├── domain/                    # 纯业务逻辑（不变）
├── app/                       # 应用服务（不变）
├── infra/
│   ├── llm/                   # 重构后：UnifiedLLMService + 适配器 + CircuitBreaker
│   ├── observability/         # 新增：ILogger + IMetricsRecorder + ITracer
│   ├── persistence/           # 扩展：新增 migrations/ + evaluation-report-repo
│   └── ...（其他不变）
├── scheduler/
│   ├── core/                  # 简化 SchedulerConfig
│   └── ...（其他不变）
├── runtime/
│   ├── react/                 # ← react-integration.ts 移至此处（从 autonomy/ 迁出）
│   │   ├── react-integration.ts
│   │   ├── message-window.ts  # 新增
│   │   └── progress-detector.ts # 新增
│   ├── execution-boundary/
│   ├── tool-boundary/         # 加固超时机制
│   └── ...（其他不变）
├── gateway/
│   └── ...（不变，但 auth-config.ts 新增）
├── ipc/                       # 加固背压机制
├── scheduler-daemon/
├── cli/
└── main.ts

删除:
├── src/autonomy/              # 整个目录删除
│   ├── react-integration.ts  # ← 移至 src/runtime/react/
│   └── daemon-event-emitter.ts  # ← 删除（Phase 4 遗留）
```

### 6.2 db/ 目录规范化

```
db/
├── migrations/
│   └── index.ts               # 所有迁移的有序数组
├── schema-base.sql            # 原 schema.sql（作为 migration v1 的 up）
├── schema-memory.sql          # 原 schema-memory.sql（作为 migration v3 的 up）
├── schema-knowledge.sql       # global_knowledge 表
├── schema-evaluation.sql      # goal_evaluation_reports 表
└── schema-metrics.sql         # metrics 表

删除:
├── schema-migration-v2.sql    # 内容合并为 migration v2
```

---

## 七、审计职责重新划分

**问题**：架构图中 Gateway 负责 Audit，但 Scheduler 内部的自动重试、预算追踪等状态变更同样需要审计，它们不经过 Gateway。这造成审计日志不完整，且职责归属不一致。

**目标设计**：审计是横切关注点，责任在 **App 层服务**，而不在 Gateway。

```typescript
// src/infra/audit/audit-service.ts（已有，调整调用方）

// 原则：
// 1. 外部操作（用户通过 RPC 触发）→ Gateway RPC Handler 写审计
// 2. 内部操作（Scheduler 自动触发）→ App 层服务（lifecycle/*.ts）写审计
// 3. 不允许同一操作被两个地方都写审计（防重复）

// 规范的审计 action 命名（区分来源）：
// user.goal.submit      → 用户通过 RPC 提交 Goal
// system.workitem.retry → Scheduler 自动重试
// system.budget.exceeded → Budget 超限自动暂停
// user.permission.grant  → 用户批准工具权限
// agent.tool.call        → Agent 调用工具
```

在 CLAUDE.md 中增加审计命名约定（`user.*` / `system.*` / `agent.*` 前缀区分操作来源），避免审计日志中 actor 语义不清。

---

## 八、完整的依赖注入改造

**问题**：`getLLMProviderManager()` 等全局单例使测试隔离困难。

**目标设计**：所有服务通过构造函数接收依赖，不使用全局 getter：

```typescript
// src/scheduler-daemon/bootstrap/default-runtime-factory.ts（示例改造）

export function buildSchedulerRuntime(config: RuntimeConfig): SchedulerRuntime {
  // 基础设施
  const db = openDatabase(config.dbPath);
  new DatabaseMigrator(db).run();  // 启动时自动迁移

  const logger = createLogger(config.logLevel);
  const metrics = new MetricsRecorder(new MetricsRepository(db), logger);
  const tracer = createTracer();   // NoopTracer 或 OTLPTracer

  // LLM 服务（单一入口，可注入，可 mock）
  const llmService: ILLMService = new UnifiedLLMService(
    buildProviderManager(config.llmConfig),
    config.workloadConfig,
    logger.child({ component: 'llm' }),
    tracer
  );

  // 工具执行
  const toolRegistry = buildToolRegistry(config.toolConfig);
  const toolExecutor = new ToolExecutor(toolRegistry, config.toolTimeouts, logger.child({ component: 'tool' }), tracer);

  // 嵌入缓存（内存 LRU + SQLite 持久化）
  const embeddingCache = new EmbeddingCache(new SqliteEmbeddingRepository(db));

  // 全局知识库
  const globalKnowledge = new GlobalKnowledgeService(new GlobalKnowledgeRepository(db));

  // ReAct 执行
  const reactLoop = new ReActIntegration(llmService, toolExecutor, embeddingCache, logger.child({ component: 'react' }), tracer);

  // Scheduler
  const scheduler = new SchedulerCore(
    reactLoop,
    new QualityGateRunner(llmService, logger.child({ component: 'quality-gate' })),
    new RetryHandler(config.retryConfig, logger.child({ component: 'retry' })),
    new BudgetTracker(metrics),
    new EscalationHandler(workOrderRepo, logger.child({ component: 'escalation' })),
    new WorkItemManager(workOrderRepo),
    config.schedulerConfig,
    logger.child({ component: 'scheduler' }),
    metrics,
    tracer
  );

  // Harness
  const goalHarness = new GoalHarness(
    new ElaborationService(llmService, globalKnowledge),
    new PlanningService(llmService),
    scheduler,
    workOrderRepo,
    logger.child({ component: 'harness' })
  );

  const evaluationReportRepo = new EvaluationReportRepository(db);
  const postGoalEvaluator = new PostGoalEvaluator(
    evaluationReportRepo,
    globalKnowledge,
    new EvaluationService(llmService),
    workOrderRepo,
    logger.child({ component: 'post-goal-evaluator' })
  );

  const harnessDaemon = new HarnessDaemon(goalHarness, scheduler, postGoalEvaluator, workOrderRepo, config.harnessDaemonConfig, logger.child({ component: 'harness-daemon' }), metrics);

  return { harnessDaemon, scheduler, metrics, tracer };
}
```

所有服务接受 `ILLMService`，不接受 `UnifiedLLMService`——程序依赖接口，测试时注入 `MockLLMService`。

---

## 九、pbwebui CLI 完成

**问题**：`pb webui start/stop/status/logs` 未完成，Web UI 无法通过 CLI 管理。

**目标设计**：对齐 `pb gateway` / `pb scheduler` 的实现模式：

```typescript
// src/cli/commands/webui.ts（重写）

export function buildWebuiCommand(): Command {
  const webui = new Command('webui').description('Web UI management');

  webui.command('start')
    .option('-p, --port <port>', 'Port number', '3000')
    .option('-f, --foreground', 'Run in foreground')
    .action(async (opts) => {
      const pidFile = getPidFilePath('webui');
      if (isRunning(pidFile)) {
        console.log('Web UI already running');
        return;
      }
      const nextDir = resolve(__dirname, '../../../web');
      const proc = spawn('node', [join(nextDir, 'node_modules/.bin/next'), 'start', '-p', opts.port], {
        cwd: nextDir,
        detached: !opts.foreground,
        stdio: opts.foreground ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NEXT_PUBLIC_GATEWAY_URL: `ws://127.0.0.1:18789` }
      });
      if (!opts.foreground) {
        writePid(pidFile, proc.pid!);
        pipeToLogFile(proc, getLogFilePath('webui'));
        proc.unref();
        console.log(`Web UI started on http://localhost:${opts.port} (PID ${proc.pid})`);
      }
    });

  webui.command('stop').action(async () => {
    stopService('webui');
  });

  webui.command('status').action(async () => {
    showServiceStatus('webui', 'http://localhost:3000');
  });

  webui.command('logs')
    .option('-f, --follow', 'Follow log output')
    .action(async (opts) => {
      tailLog('webui', opts.follow);
    });

  return webui;
}
```

---

## 十、改动影响矩阵

| 改动 | 影响范围 | 是否破坏性 | 测试要求 |
|------|---------|-----------|---------|
| UnifiedLLMService | infra/llm + 所有调用方 | 是（接口变更） | 全量 LLM 相关测试 + mock 注入 |
| Circuit Breaker | infra/llm 内部 | 否（新增） | 单元测试 + 集成测试 |
| 结构化 LLM 错误 | 适配器 + RetryHandler | 是（类型变更） | RetryHandler 所有分支 |
| MessageWindow | react-integration | 是（行为变更） | ReAct 循环长任务 E2E |
| 嵌入缓存 LRU | infra/persistence/embedding | 是（存储格式变更，需 migration） | 记忆相关功能 |
| SQLite 迁移系统 | 启动流程 | 是（替换 schema 加载） | 升级路径测试 |
| GoalEvaluationReport 持久化 | PostGoalEvaluator | 是（存储变更） | 评估报告 CRUD |
| SchedulerConfig 瘦身 | 配置文件 + 测试 | 是（字段移除） | 全量调度器测试 |
| 工具超时 | ToolExecutor | 是（行为变更） | 工具执行超时 E2E |
| IPC 背压 | ipc-client | 否（增强） | IPC 压力测试 |
| HarnessDaemon 唤醒 | harness-daemon + Gateway | 是（新接口） | Goal 提交延迟测试 |
| 目录重组（react-integration 移位） | 所有导入路径 | 是（路径变更） | 全量编译 |
| 结构化日志 | 所有服务 | 是（接口注入） | 无功能性影响，需全面替换 |
| OpenTelemetry | 可选启用，默认 NoopTracer | 否 | Span 覆盖测试 |

---

## 十一、执行顺序建议

以下顺序保证每步完成后系统仍然可运行：

```
Phase A — 无依赖的独立改动（可并行）
  A1: 目录重组（react-integration 移位 + 删除 autonomy/daemon-event-emitter.ts）
  A2: SQLite 迁移系统（替换 schema 加载，功能等价）
  A3: GoalEvaluationReport 持久化（新增表，PostGoalEvaluator 改写存储目标）
  A4: pb webui CLI 完成

Phase B — LLM 服务层（A1 完成后）
  B1: 结构化 LLM 错误类型化（适配器改造，RetryHandler 改造）
  B2: UnifiedLLMService（合并双入口，Circuit Breaker 集成）
  B3: 模型复杂度评分改进

Phase C — 可观测性（B 完成后，因为需要向 LLM 调用中注入 span）
  C1: ILogger 接口 + PinoLogger（全服务注入）
  C2: IMetricsRecorder + MetricsRepository（持久化指标）
  C3: ITracer 接口 + RuntimeEventTracer（轻量 span）

Phase D — 内存管理（C 完成后）
  D1: EmbeddingCache 改为内存 LRU（需要 migration v7）
  D2: MessageWindow（ReAct 消息修剪）
  D3: PersistentSchedulerMetrics（指标跨重启）

Phase E — 配置与错误边界（独立可并行）
  E1: SchedulerConfig 瘦身 + HarnessDaemon 唤醒机制
  E2: ToolExecutor 工具超时
  E3: IPC 背压加固
  E4: Gateway 本地鉴权策略配置化

Phase F — 审计职责重划分（最后，需要所有服务注入 logger 完成）
  F1: 审计 action 命名规范 + CLAUDE.md 更新
```

---

*本文档由 harness-architect 角色输出, 基于 `docs/plans/2026-03-29-architecture-quality-assessment.md` 架构评估报告。实施时由 planner 子 Agent 分解为具体工作项和依赖关系，由 generator 子 Agent 按批次实现，由 evaluator 子 Agent 对每个 Phase 进行回归验证。*