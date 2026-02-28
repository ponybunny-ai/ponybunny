# PonyBunny 应用层协同改造计划（Deterministic Runtime 架构升级配套）

> 日期：2026-02-27  
> 目的：梳理“已落地 runtime 架构变更”对应用层所有协同模块的连带影响，并形成可执行开发计划。  
> 范围：代码与系统架构迁移；**不包含历史数据迁移**。

---

## 1. 背景与目标

当前仓库已经完成 deterministic runtime 的一阶段能力（internal runtime RPC、plan compiler、run events、facts-only replay、dry-run）。接下来要开展应用层开发，必须先把与之配套的模块一次性梳理清楚，避免出现“接口已变更但外围仍用旧语义”的次生问题。

本计划解决四类协同改造：

1. 数据库与持久化层（`pony.db` / `memory.db`）
2. Gateway / TUI 命令与接口
3. 模型配置、加载、实例化与调用链（重点 GPT-5 家族）
4. 测试、回归、切流与发布控制

---

## 2. 已落地变化（作为本计划输入）

当前已落地的关键能力（代码证据见 `src/gateway/rpc/handlers/internal-runtime-handlers.ts` 与 `src/deterministic-runtime/*`）：

- `internal.plan.get`（plan.v1 投影，稳定 `plan_id`）
- `internal.plan.compile`（PlanCompiler，稳定错误输出）
- `internal.run.create`
- `internal.runs.events` / `internal.runs.timeline`
- `internal.runs.replay`（facts_only）
- `internal.runtime.executeDryRun`（含 override / diff / report）

这些能力目前主要在内部 RPC 层，尚未完整透传到外部应用层（TUI/命令面/生产切流控制面）。

---

## 3. 影响面总览（必须协同改造）

## 3.1 数据层（pony.db / memory.db）

### 现状
- `src/infra/persistence/schema.sql`：已有 goals/work_items/runs 等，但没有 run_events 结构化事件表。
- `src/infra/persistence/schema-memory.sql`：目前聚焦 sessions/memory entries，也未包含 runtime event 链路。
- `src/infra/persistence/repository-interface.ts` 与 `work-order-repository.ts`：尚无 run_events 持久化接口。

### 必改项
1. 在 `schema.sql` 引入 `run_events`（至少）：
   - `event_id`, `sequence`, `run_id`, `plan_id`, `event_type`, `ts_ms`, `payload_json`
   - 索引：`(run_id, sequence)`、`(run_id, ts_ms)`、`(event_type)`
2. 为 `memory.db` 明确策略（二选一）：
   - A: 不存 run_events，仅作为会话记忆库（推荐，简化职责）
   - B: 引入轻量镜像表用于 TUI 本地快速查询
3. 扩展 repository interface：
   - `appendRunEvent`, `listRunEvents`, `listRunEventsPaginated`, `listRelatedRunEvents`
4. 为兼容当前内存 store，新增 fallback 适配层（先读 DB，缺失时回退内存）。

## 3.2 Gateway / RPC / TUI

### 现状
- internal runtime RPC 已存在，但 `TuiGatewayClient` 尚无对应调用封装。
- 方法发现依赖 `system.methods` / handler 注册，外部命令面尚未形成稳定 UX。

### 必改项
1. 在 TUI client 增加 runtime 方法封装：
   - `getPlan`, `compilePlan`, `createRun`, `getRunEvents`, `getRunTimeline`, `replayRun`, `executeDryRun`
2. Gateway 层补“可观测状态”接口：
   - shadow/canary 开关读取
   - dry-run 执行统计（成功率/平均步骤数/失败码分布）
3. 命令层规范化：
   - 为 runtime 新增命令组（建议 `runtime.*`）
   - 保持旧命令可用，新增 clear migration hints
4. 接口版本化策略：
   - internal RPC 继续使用，但对外新增“稳定 facade”（防止未来频繁破坏 TUI）。

## 3.3 模型系统（GPT-5 家族专项）

### 现状证据
- `openai-protocol.ts` 当前对 GPT-5 有特判（`max_completion_tokens`），但仍普遍设置 `temperature`。
- `provider-manager/types.ts` 与 `config-loader.ts` 默认仍把 `temperature` 作为跨模型通用参数。
- `routing-config.ts` 对 `gpt-*` 是统一路由，未细化 GPT-5 家族能力差异策略。

### 风险
GPT-5 家族与其他模型在参数与响应细节上不同（例如采样参数语义差异、reasoning 字段与 token 限制策略差异），若继续“统一参数下发”，会出现：
- 无效参数被静默忽略或报错
- 模型行为不可预测（尤其多 provider 场景）
- 难以做稳定回归

### 必改项（强制）
1. 引入“模型能力矩阵驱动的参数裁剪层”：
   - 在请求发送前按模型族过滤参数（如 gpt-5 不允许/不建议参数自动剔除）
2. 扩展 llm-config schema：
   - `parameterSupport` / `disallowedParams` / `defaultReasoningProfile`
3. OpenAI 协议层拆分：
   - 将 GPT-5 特化请求构建与非 GPT-5 请求构建分支明确化
4. provider-manager 默认参数策略升级：
   - 从“全局 default temperature”改为“模型族默认参数集”
5. 回归测试：
   - gpt-5 / gpt-5-mini / gpt-5-nano 三个模型的请求体快照测试
   - 确保不会再下发不支持参数

## 3.4 已确认的关键差距（带代码证据）

### D-1：`pony.db` 存在 schema/migration 漂移
- 现象：`schema-migration-v2.sql` 中有 `goals.allowed_actions` 增量，但主初始化仅执行 `schema.sql`。
- 证据文件：
  - `src/infra/persistence/schema-migration-v2.sql`
  - `src/infra/persistence/schema.sql`
  - `src/infra/persistence/work-order-repository.ts`（`initialize()` 仅执行 schema.sql）
- 影响：新库/旧库字段集合不一致，工具策略相关能力落地会出现环境差异。

### D-2：deterministic run events 目前仅内存态
- 现象：`internal-runtime-handlers` 默认使用 `InMemoryDeterministicRunEventStore`。
- 证据文件：
  - `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
  - `src/deterministic-runtime/run-events.ts`
  - `src/infra/persistence/repository-interface.ts`（无 run_events 接口）
- 影响：重启后无法追溯/replay，无法支撑应用层持续观测。

### D-3：TUI/Gateway 客户端未完整暴露 internal runtime 新接口
- 现象：`TuiGatewayClient` 仍以 `system.* / goal.* / workitem.*` 为主，缺少 `internal.*` runtime wrappers。
- 证据文件：
  - `src/cli/gateway/tui-gateway-client.ts`
  - `src/cli/tui/commands/registry.ts`
  - `src/cli/tui/commands/handlers.ts`
- 影响：应用层无法直接消费 compile/timeline/replay/dry-run 能力。

### D-4：`internal-api.ts` 与真实 RPC surface 存在漂移
- 现象：类型命名与方法集合有历史遗留（如 generate/replay 早期命名），与当前 handler 实际接口并非完全同构。
- 证据文件：
  - `src/deterministic-runtime/internal-api.ts`
  - `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
- 影响：后续应用层开发易出现“类型对上但方法名/字段不一致”的隐性错误。

### D-5：GPT-5 家族参数兼容存在实质风险
- 现象：OpenAI 请求构建中仍默认下发 `temperature`，provider-manager 也全局注入默认 temperature。
- 证据文件：
  - `src/infra/llm/protocols/openai-protocol.ts`
  - `src/infra/llm/provider-manager/provider-manager.ts`
  - `src/infra/llm/provider-manager/types.ts`
  - `src/infra/llm/provider-manager/config-loader.ts`
- 影响：当模型族/endpoint 不接受某参数时会导致失败或行为偏差；且观测层对 Responses API 的 token 字段提取不完整。

---

## 4. 分阶段执行计划（应用层）

## P0（必须先做）— schema 漂移与类型基线修复

1. 修复 `goals.allowed_actions` 漂移（统一 schema.sql 与 migration 策略）
2. 明确并固化 migration 执行路径（初始化 + 版本升级）
3. 对齐 `internal-api.ts` 与真实 RPC surface

**验收**：新旧库字段一致、类型定义与 handler 一致、CI schema 测试通过。

## P1（高优先）— 数据与接口基线

1. `run_events` 持久化 schema 与 repository 接口落地（pony.db）
2. internal runtime handlers 改为优先使用 DB store
3. `internal.runs.events` 增加分页游标
4. 明确 `memory.db` 策略：
   - 默认不持久化 run_events（推荐）
   - 或启用轻量镜像表（仅用于本地检索）

**验收**：事件重启后可读、顺序稳定、分页正确。

## P2（高优先）— TUI/Gateway 接入

1. `tui-gateway-client.ts` 增加 runtime API 封装
2. TUI 视图增加 dry-run/compile/replay 结果展示
3. Gateway system status 增加 runtime rollout 指标

**验收**：TUI 可端到端调用 dry-run，并可查看事件时间线。

## P3（高优先）— GPT-5 适配升级

1. 模型配置 schema 扩展能力矩阵
2. 请求参数裁剪器（模型族感知）
3. OpenAI 协议层 GPT-5 专用构建路径

**验收**：gpt-5 家族调用不再携带不支持参数；全量测试通过。

## P4（中优先）— 切流与运营化

1. shadow/canary 配置面与统计面
2. `executeDryRun` 报表接入 dashboard / command 输出
3. 故障回滚开关与 runbook

**验收**：可按比例切流，异常可一键回退。

---

## 5. 任务拆分（可直接建 Issue）

## Issue-0：schema 与 API 基线统一
- 文件：
  - `src/infra/persistence/schema.sql`
  - `src/infra/persistence/schema-migration-v2.sql`
  - `src/infra/persistence/work-order-repository.ts`
  - `src/deterministic-runtime/internal-api.ts`
  - `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
- 验收：
  - `allowed_actions` 在新库与升级后旧库均可用
  - migration 可重复执行且幂等
  - internal-api 与实际 RPC 字段一致

## Issue-1：`run_events` 持久化落地
- 文件：
  - `src/infra/persistence/schema.sql`
  - `src/infra/persistence/repository-interface.ts`
  - `src/infra/persistence/work-order-repository.ts`
  - `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
- 验收：append/list/paginated 全通过。

## Issue-2：TUI runtime 命令接入
- 文件：
  - `src/cli/gateway/tui-gateway-client.ts`
  - TUI command/view 相关文件（按现有目录）
- 验收：可发起 dry-run 并查看 diff/report/replay。

建议附加文件：
- `src/cli/tui/hooks/use-gateway.ts`
- `src/cli/tui/components/views/tasks-view.tsx`
- `src/cli/tui/components/views/events-view.tsx`

## Issue-3：GPT-5 参数兼容层
- 文件：
  - `src/infra/llm/provider-manager/types.ts`
  - `src/infra/llm/provider-manager/config-loader.ts`
  - `src/infra/llm/protocols/openai-protocol.ts`
  - `src/infra/llm/provider-manager/provider-manager.ts`
- 验收：gpt-5 家族请求体快照测试全部通过。

建议附加文件：
- `src/infra/llm/unified-provider.ts`（Responses API 元数据提取）
- `src/infra/llm/provider-manager/availability-prober.ts`（探活请求参数兼容）
- `test/infra/llm/protocols/openai-protocol.test.ts`
- `test/infra/llm/provider-manager/availability-prober.test.ts`
- `test/infra/llm/unified-provider.test.ts`

## Issue-4：切流控制与观测
- 文件：
  - `src/infra/config/runtime-config.ts`
  - `src/gateway/rpc/handlers/system-handlers.ts`
  - `src/scheduler-daemon/daemon.ts`
- 验收：shadow/canary 开关+统计可读，支持回滚。

---

## 6. 验证矩阵（每个 issue 必跑）

- 定向单测（按模块）
- `npm run test:gateway`
- `npm run build`

针对 GPT-5 适配额外要求：
- 请求参数快照测试
- 模型路由与回退链测试

---

## 7. 风险与控制

1. **事件持久化引入性能开销**  
   控制：批量写、分页读、索引先行。

2. **TUI 接口变动造成兼容问题**  
   控制：保留旧命令，新命令增量引入。

3. **GPT-5 参数差异导致线上不稳定**  
   控制：参数裁剪层 + 模型族快照测试 + canary。

---

## 8. 本计划与既有计划关系

- 主升级计划：`docs/plans/2026-02-26-ponybunny-scheduler-architecture-v2-upgrade-plan.md`
- issue 拆分计划：`docs/plans/2026-02-27-ponybunny-scheduler-v2-issue-breakdown.md`

本文件是“应用层协同视角”的补充计划，优先用于下一阶段开发执行。

---

## 9. 执行进度（2026-02-27）

- P2（TUI/Gateway 接入）：已完成 runtime dry-run/timeline/events 在 TUI 任务视图的展示与刷新链路。
- P3（GPT-5 适配升级）：已完成参数裁剪与 schema 扩展，gpt-5/gpt-5-mini/gpt-5-nano 回归通过。
- P4（切流与运营化）：已完成首批控制/观测能力：
  - runtime 配置新增 rollout 面（`shadowModeEnabled` / `canaryPercent` / `rollbackOnFailure`）
  - system RPC 新增 `system.runtime.rollout.status` 与 `system.runtime.rollout.update`
  - internal dry-run 结果接入 rollout telemetry 计数器（成功率、平均步骤、失败码分布）
  - `/refresh runtime` 与 Tasks 视图输出已补充 rollout 状态与统计
  - TUI 新增 `/rollout status|set|rollback` 命令组，支持控制面直接操作
- A3（Replay 深化）已落地骨架：`internal.runs.replay mode=reexecute_tools` 返回结构化 `not_implemented` 占位，便于后续逐步填充真实重放执行链。
- A2（Compiler 深化）已落地第一批策略校验：`PlanCompiler` 支持 runtime profile 驱动的 policy 检查（`require_human_approval_for` 与 `script_sandbox` 语言/运行时/输出限制），并在 internal compile RPC 路径透传生效。
- A2（Compiler 深化）第二批策略校验已落地：`script_sandbox.no_network` 与 `script_sandbox.allowed_apps` 规则已在 compile 期生效（基于脚本 step args 中的网络/应用请求字段）。
- A2（Compiler 深化）第三批已落地：`runtime_profile` 在 compile 期接入 schema 校验，非法 profile 统一映射为 `ERR_POLICY_DENIED` 并返回结构化路径，避免策略评估在非法配置下运行。
- A2（Compiler 深化）第四批已落地：`policy.tool_allowlist/tool_denylist` 在 compile 期生效，`tool_call` 步骤会按 runtime profile 做 allow/deny 判定并返回 `ERR_POLICY_DENIED`。
- A2（Compiler 深化）第五批已落地：编译期新增 step identity 约束（重复 step id 与 self-dependency 检查），分别输出 `ERR_STEP_ID_DUPLICATE` 与 `ERR_STEP_DEPENDENCY_INVALID`，降低运行期图执行歧义。
- A2（Compiler 深化）第六批已落地：`tool_call.args` 从“仅 required 字段检查”升级为完整 `manifest.input_schema` 校验（Ajv allErrors），编译期可直接发现类型/结构不匹配并返回结构化 `ERR_TOOL_ARGS_INVALID` 路径。
- A2（Compiler 深化）第七批已落地：`default_filesystem_scope` 在 compile 期接入 `steps[].reads/writes` 约束校验；越权路径会返回 `ERR_POLICY_DENIED`（含精确 step 字段路径），将路径越界问题前置到运行前。
- A1（run_events 持久化）默认路径验证已补齐：internal runtime handlers 在 repository 支持 run event API 时默认走 repository-backed store；并增加数据库重开后的事件可读回归测试（验证重启后可追溯）。
- A1 事件读取接口增强：`internal.runs.events` 新增 `cursor` 分页（与原 `offset/limit` 兼容，含冲突参数校验与 `nextCursor` 返回），并补齐 gateway/client 回归测试。
- P0 基线修复补充：`src/deterministic-runtime/internal-api.ts` 已与实际 internal runtime RPC surface 对齐（补全 request/response 类型、run events cursor 字段、runtime rollout 配置字段与方法清单），减少类型层与 handler 漂移。
- A4（切流控制深化）已落地 lane 级 canary：runtime rollout 配置新增 `lanePercents`（dryRun/compile/replay），system rollout status/update 已支持 lane 百分比读写与模式判定，并补齐 config/gateway/TUI 侧类型与回归测试。
- A3（Replay 深化）已进入可执行骨架阶段：`reexecute_tools` 新增受控 dry-run 骨架（候选工具提取、allowlist 过滤、registry 校验、结构化 telemetry），默认仍禁用真实执行以避免副作用。
- A3（Replay 深化）继续推进：`reexecute_tools` 新增 `enableExecution`（默认 false），在开启时仅尝试执行安全/幂等工具（`side_effect=none|idempotent`），并将执行结果归档到 `reexecution` telemetry（eligible/executed/skipped）。
- A3（Replay 深化）事件化已补齐：`reexecute_tools` 执行链写回 `run_events`（requested/step_executed/step_skipped/completed），可通过 `internal.runs.events` 按事件类型追踪 replay 执行过程。
- P2/A3 协同补充：TUI `/refresh runtime` 现会触发一次 `reexecute_tools` 诊断回放（默认 dry-run skeleton），并在 Tasks 视图 Runtime Diagnostics 展示 reexecution 指标（attempted/eligible/executed/skipped）。
- P2 命令面增强：TUI 新增 `/replay` 显式命令（支持 `mode`、`allowTools`、`maxAttempts`、`enableExecution`），可直接触发并记录 replay 诊断执行。
- P2 命令面补充：`/replay` 现在会写入 runtime snapshot（含 reexecution 指标），Tasks 视图可保留并回看 replay 诊断历史。
- P2 体验细化：runtime snapshot 新增 `source/runId` 元信息，Tasks 视图优先按选中任务 `runId` 匹配 snapshot，并展示来源标签，减少 runtime/replay 混看歧义。
- P2 Replay 观察性增强：`/replay` 新增 `eventsLimit/cursor` 选项并拉取分页事件，snapshot/事件中记录分页状态（returned/offset/nextCursor），Tasks 视图可提示“是否还有下一页”。
- A2（Compiler 深化）第八批已落地：`policy.default_network=deny` 会在 compile 期拒绝 network-capable tool；`tool_routing` 也会校验“plan 不能放宽 runtime profile”。
- A2（Compiler 深化）第九批已落地：高风险工具（`requiresApproval` 或 `side_effect=non_idempotent/ui_automation`）在 compile 期强制依赖 `human_confirm`。
- A3（Replay 幂等深化）已落地：`reexecute_tools` 新增 `reexecutionIdempotencyKey`（`enableExecution=true` 必填），重复 key 会复用既有回放执行结果，避免重复副作用。
- A3（Replay 稳定性深化）已落地：候选工具去重改为稳定 canonicalization（stable stringify），参数键顺序不再导致重复重放。
- A4/P4（切流运营化）已落地：`system.runtime.rollout.update` 会实时下发 `apply_runtime_rollout` 到 scheduler-daemon，运行中可热更新 deterministic flags/rollout 配置。
- A4/P4（回滚收敛）已落地：当 dry-run 失败且 `rollbackOnFailure=true` 时，gateway 自动将 runtime 配置回滚到 legacy，并尝试同步下发到 scheduler-daemon。
- A1/WS-D（运营化）已落地：scheduler-daemon 新增 run_events retention 定时清理任务，并通过 IPC 回传 retention telemetry（runs/deleted/failed/lastRunAt）。
