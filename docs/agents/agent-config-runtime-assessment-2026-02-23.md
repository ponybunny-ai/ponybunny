# Agent 配置驱动运行链路现状评估（2026-02-23）

## 目的

本文件沉淀当前仓库中 Agent 从配置文件读取、加载、调度到运行的真实实现状态，供下一轮任务重构与设计使用。

## 评估范围

- Agent 配置发现与优先级
- 配置校验与编译
- Registry 装载与回退策略
- 调度持久化（cron_jobs）与分发
- `agent_tick` 运行时路由与 runner 执行
- 配置驱动程度、硬编码项、测试覆盖与缺口

## 端到端链路（现状）

1. **发现配置**
   - 扫描工作区与用户目录：`src/infra/agents/agent-discovery.ts:161` `discoverAgentCandidates()`
   - 路径来源：`getWorkspaceAgentsDir()`（工作区）`src/infra/agents/agent-discovery.ts:153`，`getUserAgentsDir()`（用户配置目录）`src/infra/agents/agent-discovery.ts:157`
   - 同 ID 覆盖策略：用户优先于工作区（`SOURCE_RANK` + `shouldReplaceCandidate()`）`src/infra/agents/agent-discovery.ts:33`

2. **校验与编译**
   - AJV 校验入口：`validateAgentConfig()` / `validateAndCompileAgentConfig()` `src/infra/agents/config/agent-config-validator.ts:124`
   - Schema 路径解析：`resolveSchemaPath()` `src/infra/agents/config/agent-config-validator.ts:65`
   - 运行时编译：`compileAgentConfig()` 归一化 schedule（`cron|interval`）`src/infra/agents/config/agent-config-types.ts:131`

3. **Registry 装载与稳定性**
   - 装载入口：`AgentRegistry.loadAgents()` `src/infra/agents/agent-registry.ts:59`
   - 单候选装载：`loadCandidate()` 读取 `agent.json + AGENT.md`，计算 `definitionHash`，落入内存 `Map` `src/infra/agents/agent-registry.ts:120`
   - 回退策略：无效配置时回退 `lastGood`（`using_last_good`）`src/infra/agents/agent-registry.ts:209`

4. **调度持久化与分发**
   - Registry -> cron_jobs：`reconcileCronJobsFromRegistry()` `src/infra/scheduler/cron-job-reconciler.ts:64`
   - 领取与分发：`AgentScheduler.dispatchOnce()` 生成 Goal + `agent_tick` WorkItem `src/scheduler-daemon/agent-scheduler.ts:57`
   - 幂等保障：`getOrCreateCronJobRun()`（`UNIQUE(agent_id, scheduled_for_ms)`）`src/infra/persistence/work-order-repository.ts:943`

5. **运行时执行**
   - 入口分流：`ExecutionEngineAdapter.execute()` 检测 `agent_tick` `src/gateway/integration/execution-engine-adapter.ts:46`
   - 解析上下文：`getAgentTickContext()` `src/infra/agents/agent-tick-context.ts:62`
   - runner 解析：`RunnerRegistry.resolve()`（`runner.engine` -> `type` -> `default`）`src/infra/agents/runner-registry.ts:15`
   - 默认 runner：`SchemaDrivenAgentRunner.runTick()` `src/infra/agents/schema-driven-agent-runner.ts:192`

## 实现完成度评估

### A. 已实现能力（可用）

- 配置发现、优先级覆盖、去重、ID 匹配检查链路完整。
- 配置校验（AJV）+ 编译（schedule 归一）完整，Registry 具备 last-good 稳定策略。
- 调度侧具备 durable claim、run-key 幂等、多实例竞争保护、失败计数更新。
- 执行侧可将 `agent_tick` 与普通 work item 分流，具备 runner 选择与错误回传。

### B. 部分实现 / 过渡态

1. **Scheduler 并非完全 runtime-config 驱动**
   - CLI 中 `tickIntervalMs = 1000`、`maxConcurrentGoals = 5` 为硬编码：`src/cli/commands/scheduler-daemon.ts:179`
   - `agentsEnabled` 主要由 `--agents` 开关决定：`src/cli/commands/scheduler-daemon.ts:330`
   - 但 runtime config 已定义相应字段：`src/infra/config/runtime-config.ts:17`

2. **cron 作业可运行性存在初始化缺口**
   - `claimDueCronJobs()` 要求 `next_run_at_ms` 可比较：`src/infra/persistence/work-order-repository.ts:837`
   - `upsertCronJob()` 未显式初始化 `next_run_at_ms`：`src/infra/persistence/work-order-repository.ts:790`
   - 风险表现：Agent Scheduler 已开启但没有可 claim 的任务。

3. **Schema 与运行时语义不一致**
   - Schema 允许 `replay/skip`：`agents/agent.schema.json:126`
   - 调度计算仅接受 `coalesce`，其它模式会抛错：`src/infra/scheduler/schedule-computation.ts:63`
   - `jitterMs/windows` 目前未进入调度计算主路径（定义存在，执行缺失）。

4. **Schema-driven runner 深度不足**
   - 当前主要执行多阶段 LLM 调用：`src/infra/agents/schema-driven-agent-runner.ts:139`
   - `entrypoint/subAgents/effectiveTools` 更多停留在 payload/计划层，未形成完整副作用执行闭环（如工具执行、结果落库、可观测产物）。

5. **Agent 配置热更新链路不完整**
   - `AgentRegistry.reload()` 存在：`src/infra/agents/agent-registry.ts:64`
   - 但 watcher 当前仅覆盖 credentials/llm/mcp，不含 agents 目录：`src/gateway/config/config-watcher.ts:95`

## 风险与回归关注（按优先级）

### P0

- **调度空转风险**：`next_run_at_ms` 未初始化导致无任务可调度。
- **语义断层风险**：配置允许的 catch-up 模式与运行时实现不一致，可能出现“配置合法但运行时跳过/报错”。

### P1

- **可控性风险**：运营希望通过 `ponybunny.json` 控制 tick/concurrency/agents 开关，但实际由 CLI 参数/硬编码主导。
- **执行闭环风险**：Schema-driven runner 难承载“真实 agent 行为编排”，后续功能扩展时会遇到架构瓶颈。

### P2

- **运维体验风险**：缺少 agent 配置热加载，需要重启或手动触发 reload，影响迭代效率。

## 测试覆盖现状

### 已覆盖（较好）

- 校验器与 schema 约束：`test/infra/agents/agent-config-validator.test.ts`
- registry 装载、哈希、last-good 回退：`test/infra/agents/agent-registry.test.ts`
- reconcile、调度领取与幂等、多实例竞争：
  - `test/infra/scheduler/cron-job-reconciler.test.ts`
  - `test/infra/scheduler/agent-scheduler.test.ts`
  - `test/scheduler/agent-scheduling.test.ts`
- `agent_tick` 执行分流：`test/gateway/integration/execution-engine-adapter.test.ts`

### 主要盲区

- `next_run_at_ms` 初始化策略缺乏端到端回归测试。
- 非 `coalesce` catch-up 模式的跨层一致性测试缺失。
- runtime config 对 scheduler-daemon 参数生效性的集成测试缺失。
- schema-driven runner 副作用执行（不只是 LLM 调用）的测试缺失。

## 后续任务设计建议（可直接拆 Epic）

1. **Epic-1: 调度可运行性修复（P0）**
   - 目标：确保 reconcile/upsert 后 cron job 总能进入可 claim 状态。
   - 交付：`next_run_at_ms` 初始化策略 + 回归测试。

2. **Epic-2: 调度语义一致性（P0）**
   - 目标：统一 schema 与 runtime 的 catch-up/schedule 语义。
   - 路线二选一：
     - 收敛 schema 到当前 runtime 支持集；或
     - 完整实现 `replay/skip` 与 `jitter/windows` 调度逻辑。

3. **Epic-3: runtime-config 真正接管调度参数（P1）**
   - 目标：`ponybunny.json` 成为 scheduler-daemon 默认行为来源，CLI 参数仅 override。

4. **Epic-4: schema-driven runner 执行闭环升级（P1）**
   - 目标：把 plan/payload 升级为可追踪、可回放、可审计的执行链（工具调用、结果写入、失败恢复）。

5. **Epic-5: Agent 配置热加载（P2）**
   - 目标：agent 目录变更可自动触发 reload + reconcile，最小化重启成本。

## 附：关键实现定位清单

- `src/infra/agents/agent-discovery.ts`
- `src/infra/agents/config/agent-config-validator.ts`
- `src/infra/agents/config/agent-config-types.ts`
- `src/infra/agents/agent-registry.ts`
- `src/infra/scheduler/cron-job-reconciler.ts`
- `src/scheduler-daemon/agent-scheduler.ts`
- `src/gateway/integration/execution-engine-adapter.ts`
- `src/infra/agents/runner-registry.ts`
- `src/infra/agents/schema-driven-agent-runner.ts`
- `src/cli/commands/scheduler-daemon.ts`
- `src/infra/config/runtime-config.ts`
