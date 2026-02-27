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

## A1. [WS-D] run_events 持久化存储落地

- **目标**：将当前内存事件存储升级为可持久化实现，支持分页查询。
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
- **验证命令**：
  - `npm test -- test/deterministic-runtime/run-events.test.ts test/gateway/rpc/internal-runtime-handlers.test.ts`
  - `npm run test:gateway`
  - `npm run build`

## A2. [WS-C] Compiler 深化：policy / human_confirm / sandbox 规则

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

## A3. [WS-E] Replay 深化：`reexecute_tools` 模式骨架

- **目标**：在 `internal.runs.replay` 支持受控 `reexecute_tools`（先骨架）。
- **建议文件**：
  - `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
  - `src/deterministic-runtime/internal-api.ts`
  - `test/gateway/rpc/internal-runtime-handlers.test.ts`
- **验收标准**：
  - `mode=reexecute_tools` 不再直接拒绝
  - 返回明确阶段状态（可先 `not_implemented` + 结构化占位）
  - 事件链与 summary 保持一致可解释
- **验证命令**：
  - `npm test -- test/gateway/rpc/internal-runtime-handlers.test.ts`
  - `npm run test:gateway`
  - `npm run build`

## A4. [WS-F] 真切流准备：shadow/canary 控制面

- **目标**：把 dry-run 能力挂到可运营化切流开关与观测上。
- **建议文件**：
  - `src/infra/config/runtime-config.ts`
  - `src/scheduler-daemon/daemon.ts`
  - `src/gateway/integration/scheduler-factory.ts`
  - `src/gateway/rpc/handlers/system-handlers.ts`
  - `test/infra/config/runtime-config.test.ts`
  - `test/gateway/rpc/system-handlers.test.ts`
- **验收标准**：
  - 支持 lane/percent 级别 dry-run 开关
  - 可查询当前切流状态与计数器
  - 保留一键回滚到 legacy
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
- ✅ WS-E（阶段一）：facts_only replay + facts/artifacts 索引
- ✅ WS-F（阶段一）：`internal.runtime.executeDryRun` + override + diff + report

---

## C. 推荐 Issue 创建顺序

1. A1（run_events 持久化）
2. A2（compiler policy 深化）
3. A3（reexecute_tools 骨架）
4. A4（shadow/canary 控制面）

理由：先补底座可靠性（事件持久化）和编译硬约束，再上 replay 扩展与生产切流。
