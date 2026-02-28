# PonyBunny Scheduler 核心架构升级计划（Architecture V2）

> 日期：2026-02-26  
> 范围：当前代码与系统架构升级  
> **明确不包含：历史数据迁移**

> 最近更新：2026-02-27（已按本计划连续落地 M0~WS-F 多批次，见“实施进展”章节）

---

## 1. 目标与边界

本计划基于以下文档与当前实现差距制定：

- `docs/engineering/architecture-v2.md`
- `docs/engineering/ponybunny-deterministic-runtime-pack/*`
- 当前实现：`src/scheduler/*`、`src/scheduler-daemon/*`、`src/gateway/integration/*`、`src/app/lifecycle/*`、`src/autonomy/react-integration.ts`

### 1.1 升级目标

将当前 scheduler 主链路从：

`LLM 直接工具调用驱动（ReAct + native tool calls）`

升级为：

`Plan-Only（LLM） -> Deterministic Compiler/Verifier -> Deterministic Runtime Executor -> Event Sourcing + Replay`

### 1.2 明确边界

- ✅ 包含：运行时架构、模块边界、执行链路、工具路由、事件模型、验证与切流
- ✅ 包含：当前代码改造方案与分阶段落地
- ❌ 不包含：历史 run/goal/work_item 数据迁移、回填、重算

---

## 2. 现状与关键差距（Gap）

### 2.1 当前链路（简化）

1. `goal-handlers` 提交 goal/work item（本地 scheduler 或 IPC 到 daemon）
2. `SchedulerCore` tick 驱动执行
3. `ExecutionEngineAdapter -> ExecutionService -> ReActIntegration`
4. LLM 通过工具定义直接发出 tool calls
5. 运行后再做 verification 与状态更新

### 2.2 与 V2 目标的核心差距

1. **缺 Plan-Only 契约**：LLM 仍参与执行层工具调用，不是只产出 Plan JSON。
2. **缺独立编译闸门**：无“执行前 deterministic compile/verify”强约束。
3. **Tool Manifest 未统一 V2 契约**：缺完整 `tool_ref/input_schema/output_schema/side_effect/permissions` 统一结构。
4. **确定性不足**：存在 `Date.now()/setInterval/Math.random()` 等影响重放一致性的点。
5. **事件溯源不完整**：有 execution log，但缺 V2 级 `run_events` 结构化事件流与 replay 接口。
6. **human_confirm/script sandbox 语义未 step 化**：未标准化为 `human_confirm`、`script_generate`、`script_execute` 执行图节点。

---

## 3. 目标架构（落地后）

### 3.1 目标模块

1. **Planner（LLM，Plan-Only）**
   - 输入：goal/context/tool catalog/profile/error feedback
   - 输出：严格 `plan.v1` JSON（无直接 tool call）

2. **Plan Compiler/Verifier（确定性）**
   - 固定顺序检查：schema -> deps/DAG -> tool resolve -> args schema -> policy -> side-effect/human approval -> variable contracts
   - 输出：`AcceptedPlan` 或稳定错误码集合

3. **Deterministic Runtime Executor**
   - 稳定调度（topo + step.id 字典序）
   - 固定 timeout/retry/backoff（去除随机抖动）
   - 每 step 生成并传递 idempotency key

4. **Tool Registry V2**
   - 统一四命名空间：`skills://`、`mcp://`、`local://`、`script://`
   - 所有工具提供 manifest schema

5. **Run Event Store + Replay**
   - 事件流：PLAN_ACCEPTED、RUN_STARTED、STEP_*/TOOL_*、RUN_* 等
   - 支持 `facts_only` replay（首阶段）

---

## 4. 分阶段执行计划（可直接排期）

## 4.0 实施进展（截至 2026-02-27）

### 已完成（代码已落地 + 测试验证）

- ✅ **M0：开关与骨架**
  - scheduler feature flags 已接入 runtime config / schema / daemon / factory / CLI
  - internal runtime 骨架 RPC 已建立
- ✅ **WS-A：Schema 与契约**
  - 三份 deterministic schema 已工程化
  - `schema-validator` 已接入并有单测
- ✅ **WS-B：Tool Registry V2 化（第一阶段）**
  - ToolDefinition 支持 manifest 元数据
  - built-in / MCP 适配 manifest
  - `tool-manifest-validator` + RPC 校验入口已完成
- ✅ **WS-C：Plan Compiler/Verifier（第一阶段）**
  - `PlanCompiler` 已实现固定校验顺序与稳定错误输出
  - `internal.plan.compile` 已接入
  - `internal.plan.get` 已升级为 `plan.v1` 投影（含稳定 `plan_id` 哈希）
- ✅ **WS-D：Run Events（第一阶段）**
  - `run-events` 内存存储已实现
  - compile / run 创建 / run 关联事件链已接入
  - `internal.runs.events` 支持 limit / eventTypes / relatedRunId
  - `internal.runs.timeline` 已提供阶段化视图
- ✅ **WS-E：Replay（facts_only 第一阶段）**
  - `internal.runs.replay` 已实现 facts_only 重建
  - 提供 summary + phases + facts/artifacts indexes
- ✅ **WS-F：接入与切流准备（第一阶段）**
  - `internal.runtime.executeDryRun` 串联 get->compile->run->replay
  - 支持 goal/workItem overrides（仅内存）
  - 提供 `diff` + `report(KPI)` 用于 shadow 对比

### 本轮收尾（2026-02-28）

- ✅ WS-B/WS-C 深化：补齐 default_network、tool_routing 收敛检查、风险工具 human_confirm 依赖与 filesystem 声明约束。
- ✅ WS-D 运营化收尾：scheduler-daemon 新增 run_events retention 定时清理循环，并通过 IPC 回传 retention telemetry。
- ✅ WS-E 深化：`reexecute_tools` 增加请求级 `reexecutionIdempotencyKey` 与稳定参数 canonicalization（stable stringify），避免重复执行。
- ✅ WS-F 真正切流：rollout 更新可实时下发到 scheduler-daemon（`apply_runtime_rollout`），并在 dry-run 失败且 `rollbackOnFailure=true` 时自动回滚到 legacy。

## M0：开关与骨架（1 周）

### 目标
在不改变现网行为前提下，搭好新链路入口与切换开关。

### 任务
- 新增 feature flags：
  - `scheduler.deterministicRuntime.enabled=false`
  - `scheduler.planCompiler.enabled=false`
  - `scheduler.toolRouting.mode=legacy`
- 定义内部 API 与数据契约：
  - `plans:generate`
  - `plans:compile`
  - `runs:create`
  - `runs:events`
  - `runs:replay`
- 定义统一编译/运行时错误码枚举

### 验收
- 默认行为 100% 保持 legacy 路径
- 开关可配置、可观测、可回滚

---

## WS-A：Schema 与契约落地（1 周）

### 目标
将 deterministic runtime pack 的 schema 变为代码硬约束。

### 任务
- 落地 schema 文件并纳入 runtime 校验加载：
  - `plan.schema.v1.json`
  - `runtime-profile.schema.v1.json`
  - `tool-manifest.schema.v1.json`
- 新增 schema validator 模块（建议 Ajv）
- 新增 schema 测试（合法/非法样本）

### 验收
- schema 校验结果稳定可复现
- CI 中 schema tests 全绿

---

## WS-B：Tool Registry V2 化（1-2 周）

### 目标
使编译器可基于统一 manifest 完整检查工具调用。

### 任务
- 扩展 ToolRegistry 数据结构：
  - `tool_ref`
  - `input_schema`
  - `output_schema`
  - `side_effect`
  - `permissions`
  - `supports_idempotency_key`
  - `tool_version`
- MCP / built-in / local / script 统一注册接口
- 增加 tool routing resolution order 配置

### 验收
- `registry.has(tool_ref)` 对四类工具成立
- 编译器可读取并验证 args schema

---

## WS-C：Plan Compiler/Verifier（2 周，核心）

### 目标
执行前硬闸门，拒绝低质量或违规 Plan。

### 任务
- 新增 `PlanCompiler.compile(plan, runtimeProfile, registry)`
- 固定检查顺序（不可变）
- 统一错误码与稳定排序输出
- 产物：`AcceptedPlan`（仅 compiler 通过后可执行）

### 验收
- 同输入编译结果稳定一致
- 非法 plan 不进入执行器

---

## WS-D：Deterministic Runtime Executor（2 周，核心）

### 目标
将执行从“模型驱动”改为“计划驱动 + 运行时规则驱动”。

### 任务
- 新增 runtime executor：
  - 稳定 step 调度
  - 固定 timeout/retry/backoff（去 jitter）
  - step 级 idempotency key
- 建立 run events 事件持久化
- runtime profile 支持 `system_only/system_preferred/model_preferred`（默认 `system_only`）

### 验收
- deterministic tool 集下重复执行结果一致
- 失败 run 可追溯完整链路

---

## WS-E：Replay（1 周）

### 目标
先交付 `facts_only` 可重放能力。

### 任务
- 新增 `runs.replay(runId, mode=facts_only)`
- 依据 run_events 重建最终状态和关键产物索引

### 验收
- facts_only replay 与原 run 的最终状态一致

---

## WS-F：接入改造与渐进切流（1-2 周）

### 目标
在不破坏线上稳定性的前提下替换执行主链路。

### 任务
- gateway/scheduler 入口加双通道分流：
  - legacy：`ExecutionService + ReActIntegration`
  - v2：`plan->compile->deterministic runtime`
- `scheduler-bridge` / `ipc-bridge` 补 run events 透传
- 实施 shadow/canary/default 三阶段切流

### 验收
- shadow 比对可运行
- canary 小流量稳定
- 默认切换后可一键回滚 legacy

---

## 5. 建议实施顺序与并行关系

### 5.1 串行主链

`M0 -> WS-A -> WS-B -> WS-C -> WS-D -> WS-E -> WS-F`

### 5.2 可并行项

- WS-A 与 WS-B 可部分并行（schema 落地与 registry 改造）
- WS-E 可在 WS-D 后半段并行推进

---

## 6. 风险与控制

1. **双链路并存复杂度高**
   - 控制：全链路 feature flag + shadow 模式先行

2. **工具 manifest 补齐工作量大（尤其 MCP）**
   - 控制：优先高频工具，长尾工具分批纳入

3. **外部工具天然不确定性影响“强确定性”**
   - 控制：明确 side_effect 分级 + human_confirm + idempotency key + 完整事件审计

4. **事件存储增长**
   - 控制：分页、冷热分层、归档策略（不影响语义）

---

## 7. 验收总清单（Definition of Done）

- [x] 三个 schema 已纳入工程并在 CI 校验
- [x] Tool Registry 支持四命名空间与完整 manifest（第一阶段）
- [x] Compiler 固定顺序校验 + 稳定错误码（第一阶段）
- [ ] Runtime 按 accepted plan 确定性执行（持久化执行器阶段待完成）
- [x] Run Events 可追踪（第一阶段：内存事件流 + 查询）
- [x] facts_only replay 可用（第一阶段）
- [ ] gateway/scheduler 支持双通道与可回滚切换（生产切流待完成）
- [ ] shadow/canary/default 切流文档与操作手册完备
- [x] **本次改造不包含历史数据迁移**（显式确认）

---

## 8. 已落地接口清单（当前可调用）

以下接口已在 `internal-runtime-handlers` 中落地，可用于联调与切流预演：

- `internal.runtime.config`
- `internal.plan.get`
- `internal.plan.compile`
- `internal.run.create`
- `internal.runs.events`
- `internal.runs.timeline`
- `internal.runs.replay`（当前仅 `facts_only`）
- `internal.runtime.executeDryRun`
- `internal.run.get`
- `internal.runs.byWorkItem`
- `internal.toolManifest.validate`

---

## 9. 最近验证结果（连续批次）

在连续多批次开发中，均执行了“定向单测 + gateway 回归 + build”三层验证：

- 定向单测：通过
- `npm run test:gateway`：通过（最新 10 suites / 92 tests）
- `npm run build`：通过

说明：当前已形成可持续迭代的“每步可验证”迁移基线。

配套 issue 级任务拆解见：

- `docs/plans/2026-02-27-ponybunny-scheduler-v2-issue-breakdown.md`

---

## 10. 参考文件（本计划依据）

- `docs/engineering/architecture-v2.md`
- `docs/engineering/ponybunny-deterministic-runtime-pack/plan.schema.v1.json`
- `docs/engineering/ponybunny-deterministic-runtime-pack/runtime-profile.schema.v1.json`
- `docs/engineering/ponybunny-deterministic-runtime-pack/tool-manifest.schema.v1.json`
- `docs/engineering/ponybunny-deterministic-runtime-pack/runtime-skeleton.ts`
- `docs/engineering/ponybunny-deterministic-runtime-pack/migration-plan-template.md`
