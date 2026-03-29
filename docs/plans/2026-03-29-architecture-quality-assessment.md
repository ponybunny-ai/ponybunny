# PonyBunny 架构质量评估
**软件工程视角 · 独立于 Harness 框架的系统性分析**

> **分析基准**: `docs/reverse-engineering/20260329/` 九章文档 + `CLAUDE.md`
> **分析范畴**: 架构结构、模块耦合、LLM 服务层、Gateway、路由、内存管理、可观测性、错误边界
> **立场**: 纯软件工程视角，不涉及 Harness 概念评判

---

## 综合评定

| 领域 | 评级 | 主要依据 |
|------|------|---------|
| 整体架构结构 | B+ | 六边形架构正确，ADR-001 分离清晰，但有若干组织残留 |
| LLM 服务层 | C+ | 双入口点是明确的抽象泄漏，错误模式匹配脆弱 |
| Gateway | B | 功能分解好，但审计职责位置有争议，本地自动鉴权风险高 |
| 路由设计 | C+ | 工具路由良好，LLM 路由有历史积累痕迹，模型复杂度评分弱 |
| 内存管理 | B- | 持久层设计细致，临时内存边界模糊，缓存写放大问题 |
| 可观测性 | C+ | 事件流丰富，但指标是内存瞬态，无结构化日志，缺告警机制 |
| 错误边界 | B | PostGoalEvaluator 的设计是典范，但 ReAct 循环的边界较粗 |
| 模块化/耦合 | B- | 层规则明确但有若干实质违反，遗留目录名掩盖了真实结构 |

---

## 一、整体架构：优势与结构性问题

### 1.1 正确的部分

**六边形架构的层规则执行严格**，方向依赖表达清晰：

```
Domain ← App ← Infra ← (Scheduler / Runtime)
                      ← Harness
                                ← Gateway ← CLI
```

`src/domain/` 的"无外部依赖"不变量一旦守住，整个系统的可测试性和可替换性就有了保障。这是系统最重要的正确决策之一。

**ADR-001 的三方分离**（GoalHarness / SchedulerCore / PostGoalEvaluator）在原则上是正确的。三个不变量对应了三种不同的关注点：计划、执行、观察。

**两进程架构**（Gateway + Scheduler Daemon）通过 Unix Socket 通信，是合理的进程隔离方式：一个进程的崩溃不会直接拖垮另一个。IPC 的重连、消息缓冲、心跳设计也是标准实践。

### 1.2 结构性问题

**问题 1：并发上限在两个层面各自声明，存在不一致**

```typescript
// HarnessDaemon
maxConcurrentGoals: 2     // 进入 GoalHarness 的并发上限

// SchedulerConfig
maxConcurrentGoals: 5     // 进入 SchedulerCore 的并发上限
```

两个数字独立存在，没有关联约束。HarnessDaemon 是前置门控，实际上从不允许超过 2 个 Goal 进入 SchedulerCore，SchedulerCore 的 5 是死代码。更严重的是：如果 HarnessDaemon 的限制被调高，SchedulerCore 的限制不会自动跟进，行为变化是隐式的。

**正确设计**：一个地方声明并发上限，另一个地方从接口读取，或者明确两个数字服务不同目的（前者限制计划并发，后者限制执行并发）并文档化其关系。

---

**问题 2：ReAct 循环生活在遗留目录 `src/autonomy/`**

```
src/autonomy/
├── react-integration.ts   ← 整个系统的核心执行引擎
└── daemon-event-emitter.ts ← Phase 4 删除 AutonomyDaemon 后的遗留物
```

`AutonomyDaemon` 已在 ADR-001 Phase 4 删除，但 `daemon-event-emitter.ts` 仍然存在。更重要的是，`react-integration.ts` 是系统核心，但它的目录名（`autonomy/`）暗示这是一个"自治"子系统，而不是"核心执行引擎"。

任何新加入的开发者都会误判这个文件的重要性——"autonomy"听起来像个边缘功能，实际上是所有 WorkItem 执行的入口。

**建议**：将 `react-integration.ts` 移至 `src/runtime/react/` 或 `src/app/execution/`，删除 `daemon-event-emitter.ts`，整个 `src/autonomy/` 目录可以消除。

---

**问题 3：SchedulerConfig 混合了不同关注点**

```typescript
SchedulerConfig {
  tickIntervalMs: 1000              // 执行频率
  maxConcurrentGoals: 5             // 并发限制
  executionMode: 'direct' | 'evented'  // 执行模式
  toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred'  // 历史积累
  runtimeRollout: {                 // 金丝雀/影子模式
    shadowModeEnabled: boolean
    canaryPercent: number
    rollbackOnFailure: boolean
    lanePercents: { dryRun, compile, replay }
  }
  planCompilerEnabled: boolean      // 文档中未解释
  deterministicRuntimeEnabled: boolean  // 文档中未解释
}
```

这一个 Config 结构混合了：执行基础参数、工具路由模式、生产流量管理（金丝雀）、功能开关。

`runtimeRollout` 是生产流量管理基础设施（canaryPercent、shadowMode），这对一个本地优先的单机工具来说是过早的复杂性，或者是死代码。`planCompilerEnabled` 和 `deterministicRuntimeEnabled` 这两个 boolean 在文档中没有解释，是配置迷雾。

`toolRoutingMode` 有 4 个选项，其中 `'legacy'` 存在就意味着"旧行为还在但不推荐"——这是技术债的配置化。

---

## 二、LLM 服务层

### 2.1 双入口点是明确的抽象泄漏

```
LLMProviderManager.complete('execution', messages)
    → workload → tier → model

LLMService.getModelForTier('complex')
    → tier → model
```

两个完全独立的方式到达同一个目标（选择并调用 LLM 模型）。调用方必须知道：哪种场景用哪个入口。这违反了"单一入口"原则。

更糟的是，`getLLMProviderManager()` 的函数命名暗示这是一个**单例**（get 一个全局实例）。全局单例使测试变得困难，每个测试都可能共享同一个状态，需要复杂的 mock 设置。

**建议**：统一为一个接口，LLMService 对外，workload → tier 映射作为内部实现细节：

```typescript
interface ILLMService {
  complete(workload: LLMWorkload, messages: LLMMessage[]): Promise<LLMResponse>
  completeWithModel(model: string, messages: LLMMessage[]): Promise<LLMResponse>
}
// workload: 'execution' | 'planning' | 'evaluation' | 'conversation'
```

### 2.2 RetryHandler 的错误模式匹配基于字符串，脆弱

```typescript
// src/scheduler/retry-handler/retry-handler.ts 的推断行为
patterns = {
  'rate_limit': { recoverable: true, strategy: 'same_model' },
  '429':        { recoverable: true, strategy: 'same_model' },
  'context_length': { recoverable: true, strategy: 'switch_model' },
  '401':        { recoverable: false, strategy: 'escalate' },
}
```

这个匹配是在**错误消息字符串**上做的。任何 LLM 提供商修改其错误消息格式（哪怕只是大小写），都会静默地破坏匹配逻辑，使正确的重试策略失效。

协议适配器层（AnthropicProtocolAdapter、OpenAIProtocolAdapter）是将提供商原始错误转化为**结构化错误类型**的最佳位置。RetryHandler 应该接收结构化的错误类型，而不是原始字符串。

```typescript
// 更健壮的设计
type LLMErrorCode =
  | 'rate_limited'
  | 'context_exceeded'
  | 'auth_failed'
  | 'content_policy'
  | 'server_error'
  | 'timeout'

interface LLMProviderError {
  code: LLMErrorCode  // 结构化，由适配器负责转换
  provider: string
  recoverable: boolean
  retryAfterMs?: number  // rate limit 场景下的精确等待时间
}
```

### 2.3 无电路断路器（Circuit Breaker）

当 LLM 提供商连续失败时，当前设计每次都先尝试主提供商，失败后才切换：

```
尝试 Claude → 失败（指数退避等待）→ 重试 Claude → 失败 → ... → 切换 GPT
```

没有 Circuit Breaker 意味着即使知道提供商已经宕机，系统仍然会在每次尝试前等待。正确的设计是：N 次失败后打开断路器，在冷却期内直接路由到备用提供商，不需要等待。

`UnifiedLLMProvider` 的"Automatic fallback to secondary endpoints"可能已经处理了部分场景，但 RetryHandler 的 `same_model` 策略会在 fallback 之前产生冗余等待。

### 2.4 LLM 调用无超时保证的统一层

`llm-config.json` 中有全局 `timeout: 30000`，但各协议适配器的超时实现可能不一致。如果某个适配器忘记应用超时，ReAct 循环可能在等待 LLM 响应时无限阻塞，消耗掉整个 workItem 的执行时长预算，而 BudgetTracker 的 `time` 维度只能在事后检测到超支。

---

## 三、Gateway

### 3.1 本地自动鉴权的风险被低估

```typescript
// 127.0.0.1 或 ::1 → 自动获得 ['read', 'write', 'admin']
```

这个设计对于"只在开发者自己机器上运行"的假设是合理的。但：

- 任何在同一台机器上运行的进程（恶意脚本、被攻陷的依赖包）都可以不经鉴权访问完整的 admin API
- 在 Docker 容器场景或 CI 环境中，同一网络下的其他容器可能可以访问
- 用户通过 `pb gateway pair` 创建的 Token 有权限控制，但本地连接绕过了这一套机制

这不是说设计一定错了，而是**这个安全假设应该被明确记录为使用前提**，并有选项（哪怕是配置项）让高安全需求用户关闭本地自动鉴权。

### 3.2 审计日志的责任归属有争议

系统架构图中，Gateway 负责 Audit Log。但审计是一个横切关注点（cross-cutting concern）——Scheduler 内部的自动重试、预算追踪、质量门控产生的状态变更，同样应该被审计，但它们不经过 Gateway。

实际情况是 `audit_logs` 表和 `AuditLogRepository` 在 `infra/` 层，Scheduler 可以直接写入——但这个访问路径没有在架构图中表达出来。架构图和实际责任边界不一致。

**需要明确的问题**：谁负责写入审计日志？是 Gateway RPC Handler 在外部操作时写，还是 App/Infra 层服务在状态变更时写？如果两者都写，是否有重复的可能？

### 3.3 事件订阅的内存管理

```typescript
goal.subscribe(goalId)  // 订阅特定 goal 的事件
// 客户端断开 → 自动 unsubscribe？
```

如果客户端订阅后异常断开（网络中断、进程崩溃），Gateway 是否自动清理订阅？长时间运行的系统中，僵尸订阅会积累，事件广播会向不存在的连接发送，造成无效的序列化和网络工作。WebSocket 心跳（30s ping/10s pong timeout）会清理连接，但订阅列表是否随之清理需要确认。

---

## 四、路由设计

### 4.1 模型复杂度评分是弱代理

```
description length (40%) + success_criteria count (30%) + priority (20%) + budget_tokens (10%)
```

这四个因子没有一个能可靠地预测 LLM 计算复杂度：

- **描述长度 40%**：一行指令"重构整个认证系统为 JWT"极其复杂，2000 字的详细需求可能很简单。长度和复杂度没有相关性。
- **优先级 20%**：优先级是重要性和紧迫性，和需要多强的模型无关。一个"紧急的简单 bug fix"会被不恰当地路由到更强的模型。
- **budget_tokens 10%**：预算是用户设定的约束，不是任务本身的计算需求。

这个评分系统会**系统性地误路由**：高优先级的简单任务用了贵的模型，低优先级的复杂任务用了弱的模型。

**更可靠的信号**：`item_type`（refactor vs analysis vs test vs code 的复杂度分布不同）、`estimated_effort`（S/M/L/XL 是人工估算，比描述长度更可靠）、`dependency count`（依赖多的任务通常更复杂）。

### 4.2 Lane 选择的上限设计存在隐式约束

```
main lane:    max 1 并发
subagent lane: max 3 并发
cron lane:    max 2 并发
session lane: max 1 并发
```

总并发上限 = 7，但 SchedulerConfig 中 `maxConcurrentGoals: 5`。这两个数字没有显式关联：如果 5 个 Goal 都被选入 subagent lane，理论上需要 3×5=15 个并发，但 subagent lane 只允许 3 个。Lane 上限和 Goal 上限共同约束执行，但它们的交互逻辑没有文档化。

### 4.3 工具路由的 4 种模式

```typescript
toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred'
```

存在 `legacy` 模式是技术债被配置化的信号。这意味着旧的路由行为还活着，但"不推荐"。每个模式的具体行为在文档中未解释。这种模式累积是需要清理的配置迷雾——4 个选项中，理想状态应该只有 1-2 个。

---

## 五、内存管理

### 5.1 临时内存边界模糊

系统中存在多种未明确标注生命周期的内存存储：

| 存储 | 生命周期 | 丢失风险 |
|------|---------|---------|
| TUI store (Redux-like) | 进程生命周期 | 低（UI 状态） |
| ReAct 消息积累 | 单次 WorkItem 执行 | 低（可重算） |
| GoalEvaluationReport (max 100) | 进程生命周期，最多 100 条 | **高**（评估报告不持久化，重启丢失） |
| SchedulerMetrics | 进程生命周期 | 中（聚合值，重启归零） |
| Runtime Event Bus | 进程生命周期 | 低（事件已持久化到 runtime_events 表） |

**GoalEvaluationReport 的内存存储是最严重的边界问题**。这是 ADR-001 Phase 5 新加的观察结果，但 CLAUDE.md 中强调了"Auditability is mandatory"。GoalEvaluationReport 包含了每个 WorkItem 的评估决策（publish/retry/replan/escalate），这是有价值的审计数据，但进程重启后消失。

**SchedulerMetrics 的重启归零**意味着 `totalGoalsProcessed` 等计数器只反映"本次启动以来"的数据，没有历史累计。

### 5.2 ReAct 循环的内存增长无上界约束

ReAct 循环将每次 LLM 调用和工具结果累积在 messages 数组中：

```
iteration 1: [system_prompt, user_message, assistant_response, tool_result]
iteration 2: [...iteration_1, assistant_response, tool_result]
...
iteration 20: [...full_history]
```

在 max_iterations=20 的情况下，如果工具返回大量数据（比如 `read_file` 读取大文件，`execute_command` 产生大量输出），消息数组可能增长到数十 MB。这不仅增加 LLM API 调用的 token 成本，也是 Node.js 进程内存压力的来源。

没有在单次 ReAct 循环内做消息修剪或截断的机制。LLM 的 context window 限制会在外部（API 返回 context_length 错误）触发，而不是在内部主动管理。

### 5.3 向量嵌入缓存的写放大问题

```typescript
// embedding_cache 表
last_accessed_at: INTEGER NOT NULL  // For LRU eviction
access_count: INTEGER NOT NULL
```

每次**读取**嵌入向量，都需要**写入**两个字段（`last_accessed_at` 和 `access_count`）。这是读操作引发写操作的典型写放大问题。在高频相似度检索场景下，嵌入缓存的读取会产生大量 SQLite 写事务，与其他操作竞争写锁。

**更轻量的替代**：使用 LRU 内存缓存（`lru-cache` 包），仅在缓存驱逐时做 SQLite 读写。SQLite 的嵌入缓存适合"持久化到重启"的需求，但对于访问统计，内存 LRU 就够了。

### 5.4 SQLite 单库承载所有写入

```
goals + work_items + runs + artifacts
+ audit_logs（高频写）
+ permissions + cron
+ sessions + memory_entries（向量）
+ embedding_cache
```

`audit_logs` 是每次状态变更都写入的高频表（写入频率远高于其他表）。所有这些写入都通过同一个 SQLite 文件和写锁串行化。虽然 `better-sqlite3` 是同步接口（性能好），但高并发的审计写入可能成为瓶颈。

更值得关注的是：`schema.sql` + `schema-memory.sql` + `schema-migration-v2.sql` 是有机生长的产物，不是托管的迁移系统。没有迁移版本表，没有 up/down 迁移脚本管理，`migration-v2.sql` 的命名方式意味着如果需要 v3、v4，管理成本会线性增长。

---

## 六、可观测性

### 6.1 指标是瞬态内存聚合，无时间序列

```typescript
SchedulerMetrics {
  totalGoalsProcessed: number      // 本次启动累计
  successRate: number              // 本次启动计算
  averageWorkItemDurationMs: number // 本次启动均值
  // ...
}
```

这些指标在进程重启后归零。`successRate` 是所有历史 runs 的成功率，但只记录了本次启动期间的 runs。系统运行了多少天，你无法从这里看到趋势——是在变好还是变差。

没有时间维度的指标只能回答"现在怎样"，无法回答"是否在改善"。这对 harness-optimizer 子 Agent 特别不利。

### 6.2 结构化日志缺失

文档中提到 `gateway.log` 和 `scheduler.log`，以及 debug flags 控制的 `console.log`。但没有提到日志的结构（是 plain text 还是 JSON Lines？），没有日志级别的统一规范，没有 correlation ID 将同一 Goal 的日志串联。

当一个 Goal 失败时，要找到所有相关的日志行，需要手动 grep goalId。如果日志是 JSON Lines with `goalId` / `runId` / `workItemId` 字段，就可以用 `jq` 或任何日志聚合工具直接过滤。

### 6.3 可观测性的三个层面不对等

```
事件（Events）: 丰富 ✅
  goal.created, run.started, verification.completed, budget.warning...
  
指标（Metrics）: 粗糙 ⚠️
  SchedulerMetrics（瞬态，无时间序列，无直方图，无百分位）
  
追踪（Traces）: 缺失 ❌
  无法将一个用户请求跟踪到它触发的所有下游操作
```

没有分布式追踪意味着：当 ReAct 循环在第 15 次迭代时失败，你知道发生了什么（audit_log + error_signature），但你不知道前 14 次迭代分别耗时多少、哪次工具调用最慢、LLM 调用在所有时间中占多大比例。

OpenTelemetry 集成在此系统中完全缺失。哪怕只是在 ReAct 循环的关键路径上加 span，诊断能力就会提升一个量级。

### 6.4 Debug 服务器是独立包，但与主系统的边界不明确

```
debug-server/
├── server/src/
│   ├── api-server.ts       # HTTP API + WebSocket
│   └── websocket.ts
└── webui/                  # Next.js debug dashboard
```

Debug 服务器作为独立包是好的设计——观测工具不应该和被观测系统耦合。但文档中没有说明 debug server 访问系统数据的方式：是直接读 SQLite？还是通过 Gateway WebSocket？两种方式的延迟和一致性特征完全不同。

如果 debug server 直接读 SQLite，与 Scheduler 的写操作存在潜在的写-读竞争（尽管 SQLite 的 WAL 模式可以缓解）。

---

## 七、错误边界

### 7.1 PostGoalEvaluator 的错误边界设计是典范

```typescript
// src/harness/post-goal-evaluator.ts
// Fire-and-forget: 异步错误被 catch，永不重抛
// Bounded storage: max 100 reports
// No side effects: 不修改 scheduler 状态
```

这三个约束合在一起，保证了 PostGoalEvaluator 的任何失败都不会影响核心执行路径。这是正确的错误边界设计——观察者不应该影响被观察者。

### 7.2 ReAct 循环的错误边界较粗

ReAct 循环（`react-integration.ts`）是整个系统最高风险的代码——它调用外部 LLM API、执行工具命令、积累状态。但从文档中看不到：

- 是否有对单次工具执行的超时保护？（`execute_command` 可能永不返回）
- 工具执行失败（非 LLM 错误）如何传递？是让 LLM 看到错误信息重试，还是立即终止循环？
- `max no-action iterations: 3` 是否有专门的检测逻辑，还是 3 次"没有 tool_calls 的 LLM 响应"就是依据？

`execute_command` 工具在 Layer 2（需要人工审批）是对的，但一旦审批通过，被执行的命令本身没有超时保护。一个 `find /` 可以让 ReAct 循环永久阻塞。

### 7.3 IPC 消息缓冲满时的无声丢失

```
IPC buffer: max 1000 messages
```

当 Scheduler 产生事件的速度超过 Gateway 消费速度时，第 1001 条消息会被丢弃。没有文档说明这里的丢失是否被记录，也没有背压机制。

在实际使用中，如果同时有多个 Goal 并发执行，产生大量 run_started / tool_call / verification_completed 事件，1000 条上限可能比想象中更容易触达。丢失事件意味着 Gateway 广播给客户端的事件序列不完整，TUI 可能显示陈旧状态。

### 7.4 HarnessDaemon 轮询间隔与 SchedulerCore Tick 的关系

```
HarnessDaemon: pollingIntervalMs = 5000ms（5秒一次）
SchedulerCore: tickIntervalMs = 1000ms（1秒一次）
```

GoalHarness 每 5 秒检查一次是否有新 Goal 需要处理，而 SchedulerCore 每 1 秒 tick 一次执行。这意味着一个新提交的 Goal 最多等待 5 秒才被 GoalHarness 捡起。这个延迟在文档中没有说明，用户视角会看到"提交 Goal 后最多 5 秒无响应"。

如果 Goal 提交可以发送 IPC 信号通知 HarnessDaemon 立即处理（而不是等待下次轮询），用户体验会更好。

---

## 八、关键改进建议汇总

按影响范围和实施难度排序：

### 立即（不涉及架构变更）

1. **移动 `react-integration.ts` 到 `src/runtime/react/`**，删除 `src/autonomy/daemon-event-emitter.ts`——目录重组，不影响运行时。

2. **GoalEvaluationReport 持久化**——在 SQLite 新增 `goal_evaluation_reports` 表，PostGoalEvaluator 写入 SQLite 而不是内存数组。这让审计数据跨重启保留。

3. **SchedulerMetrics 持久化累计值**——在 `meta` 表中存储累计指标，重启后从 `meta` 恢复计数器，实现跨重启的历史累计。

4. **GoalEvaluationReport RPC 接口**——`evaluation.list` / `evaluation.get`，暴露已有数据。

5. **统一并发上限**——明确 HarnessDaemon 的 `maxConcurrentGoals: 2` 是否等同于 SchedulerCore 的 `maxConcurrentGoals: 5`，移除其中一个或文档化它们的不同语义。

### 中期（局部重构）

6. **统一 LLM 服务入口**——合并 `LLMProviderManager` 和 `LLMService` 为单一接口，用 `workload` 参数区分场景，消除双入口。

7. **LLM 错误类型化**——在协议适配器层将提供商错误转换为结构化 `LLMErrorCode`，RetryHandler 接收类型而非字符串模式。

8. **ReAct 循环工具超时**——对每次工具执行增加独立超时（默认 30s），防止 `execute_command` 无限阻塞。

9. **SQLite 迁移系统**——引入 `db-migrate` 或 `umzug`，将 `schema-migration-v2.sql` 纳入版本化迁移管理，避免手动 SQL 文件积累。

10. **改进模型复杂度评分**——将 `estimated_effort` 和 `item_type` 纳入评分，移除 `priority` 因子（优先级和计算复杂度无关）。

### 长期（架构层面）

11. **结构化日志**——所有 `console.log` 替换为结构化 JSON 日志（`pino` 或类似），包含 `goalId` / `runId` / `workItemId` 字段，支持流式到任何日志聚合工具。

12. **关键路径 OpenTelemetry span**——在 ReAct 循环、LLM 调用、工具执行处添加 span，实现端对端延迟分析。

13. **向量缓存改为内存 LRU**——`embedding_cache` 的 LRU 逻辑移至内存（`lru-cache`），只用 SQLite 做启动时加载，避免读操作引发写。

14. **Goal 提交触发 HarnessDaemon 唤醒**——通过内部 event 或信号，让 Gateway 的 `submit_goal` 立即唤醒 HarnessDaemon，消除最多 5 秒的轮询延迟。

15. **清理 SchedulerConfig**——移除 `runtimeRollout` 金丝雀配置（local-first 工具不需要），明确或移除 `planCompilerEnabled` / `deterministicRuntimeEnabled`，整理 `toolRoutingMode` 为 2 个有意义的选项。

---

## 附：各模块软件工程评分细则

### LLM 服务层

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 单一入口 | ❌ | 双入口（LLMProviderManager + LLMService） |
| 依赖注入 | ⚠️ | `getLLMProviderManager()` 暗示全局单例 |
| 错误类型化 | ❌ | RetryHandler 基于字符串模式匹配 |
| 超时统一管理 | ⚠️ | 全局配置存在，各适配器实现可能不一致 |
| 电路断路器 | ❌ | 无 |
| 可测试性 | ⚠️ | 单例模式使隔离测试困难 |

### Gateway

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 职责单一 | ⚠️ | 审计日志责任归属不明确 |
| 认证模型 | ⚠️ | 本地自动 admin 需要明确安全假设 |
| 背压机制 | ❌ | IPC buffer 满时无声丢弃 |
| 连接清理 | ⚠️ | 订阅清理依赖心跳，文档未明确 |
| 17+ RPC 模块分解 | ✅ | 按功能分组良好 |

### 内存管理

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 临时内存边界文档 | ❌ | GoalEvaluationReport 等未标注生命周期 |
| ReAct 消息上界 | ❌ | 无循环内消息修剪机制 |
| 向量缓存写放大 | ⚠️ | 读操作触发 last_accessed_at 写入 |
| 数据库迁移管理 | ❌ | 有机生长的 SQL 文件，无版本化管理 |
| 跨重启数据保留 | ⚠️ | 部分指标和报告重启丢失 |

### 可观测性

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 事件丰富度 | ✅ | 20+ 事件类型，覆盖主要生命周期 |
| 指标时间序列 | ❌ | 仅瞬态内存聚合 |
| 结构化日志 | ❌ | 未提及，推测为 plain text |
| 分布式追踪 | ❌ | 无 OpenTelemetry 或等效方案 |
| 错误聚类可查询性 | ✅ | error_signature + getRepeatedErrorSignatures() |
| 审计完整性 | ⚠️ | 高频写与操作写共享同一 SQLite |

---

*本评估基于文档分析，不涉及源码直接审查。部分问题（如具体的 SQLite WAL 配置、适配器超时实现）需要代码级确认。建议将此文档中的"问题"节作为 GitHub Issues 的候选列表，由 harness-architect 子 Agent 评估修复优先级。*