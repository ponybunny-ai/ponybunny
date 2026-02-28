# PonyBunny Scheduler V2 升级任务拆解（可直接建 Issue）

> 日期：2026-02-27  
> 来源：`docs/plans/2026-02-26-ponybunny-scheduler-architecture-v2-upgrade-plan.md`  
> 范围：当前代码与架构迁移（不含历史数据迁移）

---

## 使用说明

每个任务可直接转为 GitHub Issue。建议字段：

- **Title**：`[WS-X] ...`
- **Labels**：`arch-v2`, `scheduler`, `runtime`, `deterministic`
- **Acceptance**：使用本文“验收标准”
- **Verification**：按本文“验证命令”执行

---

## A. 待完成任务清单（按优先级）

## A1. [WS-D] run_events 持久化存储落地（已完成）

- **目标**：将当前内存事件存储升级为可持久化实现，支持分页查询与保留策略裁剪。
- **建议文件**：
  - `src/deterministic-runtime/run-events.ts`
  - `src/infra/persistence/repository-interface.ts`
  - `src/infra/persistence/work-order-repository.ts`
  - `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
  - `test/deterministic-runtime/run-events.test.ts`
  - `test/gateway/rpc/internal-runtime-handlers.test.ts`
- **验收标准**：
  - 同一 `run_id` 的事件可跨进程重读
  - `internal.runs.events` 支持分页参数（如 `cursor/offset + limit`）
  - 排序稳定（`ts_ms + sequence`）
  - `internal.runs.events.prune` 支持按时间/运行ID/事件类型裁剪，并返回删除计数
- **验证命令**：
  - `npm test -- test/deterministic-runtime/run-events.test.ts test/gateway/rpc/internal-runtime-handlers.test.ts`
  - `npm run test:gateway`
  - `npm run build`

## A2. [WS-C] Compiler 深化：policy / human_confirm / sandbox 规则（已完成）

- **目标**：在 `PlanCompiler` 增加策略层校验（超越 schema/deps/tool/args）。
- **建议文件**：
  - `src/deterministic-runtime/plan-compiler.ts`
  - `src/deterministic-runtime/error-codes.ts`
  - `src/deterministic-runtime/schemas/runtime-profile.schema.v1.json`
  - `test/deterministic-runtime/plan-compiler.test.ts`
- **验收标准**：
  - `human_confirm` 步骤触发规则可配置
  - script 相关步骤遵循 runtime profile sandbox 限制
  - 新增错误码覆盖并稳定排序输出
- **验证命令**：
  - `npm test -- test/deterministic-runtime/plan-compiler.test.ts`
  - `npm run build`

## A3. [WS-E] Replay 深化：`reexecute_tools` 模式（已完成幂等深化）

- **目标**：在 `internal.runs.replay` 支持受控 `reexecute_tools`，并具备请求级幂等保护。
- **建议文件**：
  - `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
  - `src/deterministic-runtime/internal-api.ts`
  - `test/gateway/rpc/internal-runtime-handlers.test.ts`
- **验收标准**：
  - `mode=reexecute_tools` 支持受控执行与结构化 telemetry
  - `enableExecution=true` 时要求 `reexecutionIdempotencyKey`，重复 key 复用既有结果
  - 候选工具提取按稳定 canonicalization 去重（参数顺序不影响）
  - 事件链与 summary 保持一致可解释
- **验证命令**：
  - `npm test -- test/gateway/rpc/internal-runtime-handlers.test.ts`
  - `npm run test:gateway`
  - `npm run build`

## A4. [WS-F] 真切流准备：shadow/canary 控制面（已完成）

- **目标**：把 dry-run 能力挂到可运营化切流开关与观测上。
- **建议文件**：
  - `src/infra/config/runtime-config.ts`
  - `src/scheduler-daemon/daemon.ts`
  - `src/gateway/integration/scheduler-factory.ts`
  - `src/gateway/integration/ipc-bridge.ts`
  - `src/gateway/gateway-server.ts`
  - `src/ipc/types.ts`
  - `src/scheduler/core/scheduler.ts`
  - `src/gateway/rpc/handlers/system-handlers.ts`
  - `test/infra/config/runtime-config.test.ts`
  - `test/gateway/rpc/system-handlers.test.ts`
- **验收标准**：
  - 支持 lane/percent 级别 dry-run 开关
  - 可查询当前切流状态与计数器
  - 保留一键回滚到 legacy
  - rollout 更新可实时下发 scheduler-daemon 并生效（无需重启）
  - `rollbackOnFailure` 在 dry-run 失败场景触发自动回滚
- **验证命令**：
  - `npm test -- test/infra/config/runtime-config.test.ts test/gateway/rpc/system-handlers.test.ts`
  - `npm run test:gateway`
  - `npm run build`

---

## B. 已完成任务（用于迁移基线）

- ✅ M0：feature flags + internal runtime 骨架
- ✅ WS-A：三份 schema + validator + 单测
- ✅ WS-B（阶段一）：manifest 元数据 + validator + RPC 校验
- ✅ WS-C（阶段一）：PlanCompiler + `internal.plan.get/compile`
- ✅ WS-D（阶段一）：run_events 内存链路 + events/timeline 查询
- ✅ WS-D（阶段二）：run_events 持久化 + 分页 + prune 保留策略（repository/RPC/TUI）
- ✅ WS-E（阶段一）：facts_only replay + facts/artifacts 索引
- ✅ WS-E（阶段二）：reexecute_tools skeleton + 幂等 key + stable candidate 去重
- ✅ WS-F（阶段一）：`internal.runtime.executeDryRun` + override + diff + report
- ✅ WS-F（阶段二）：rollout 实时下发（gateway↔scheduler IPC）+ rollbackOnFailure 自动回滚

---

## C. 推荐 Issue 创建顺序

1. A1（run_events 持久化）
2. A2（compiler policy 深化）
3. A3（reexecute_tools 骨架）
4. A4（shadow/canary 控制面）

理由：先补底座可靠性（事件持久化）和编译硬约束，再上 replay 扩展与生产切流。
