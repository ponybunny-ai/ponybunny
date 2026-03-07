# PonyBunny To-Be 重构设计（Gateway / Scheduler / Channels）

本目录基于 `docs/refine/flow/README.md` 的问题清单，给出完整的系统改进/重构方案。

## 目标（来自本轮设计约束）

1. TUI 不做显式分流，仅保留自然语言会话通道（session-first only）。
2. 分流/决策由 `IInputAnalysisService` 在 Scheduler 侧进行。
3. 打通 session-first 与 scheduler 的断链，业务动作统一在 Scheduler 进程完成。
4. Scheduler 统一暴露可实时双向通信的接口（RPC/stream events）。
5. Gateway 升级为多渠道接入层（email、TUI、webui、telegram、whatsapp、discord 等）并支持多渠道广播。
6. 严格角色划分：
   - Scheduler = 大脑 + 执行手
   - Gateway = 输入（眼耳）+ 输出（嘴）+ 路由

## 文档目录

1. [01-architecture-principles.md](./01-architecture-principles.md)
   - 角色边界、核心原则、反模式禁令
2. [02-target-architecture-overview.md](./02-target-architecture-overview.md)
   - To-Be 组件图与职责映射
3. [03-scheduler-intake-and-decisioning.md](./03-scheduler-intake-and-decisioning.md)
   - session-first 统一入口 + input analysis 决策设计
4. [04-gateway-channel-router.md](./04-gateway-channel-router.md)
   - Gateway 多渠道模型与路由/广播策略
5. [05-control-plane-protocol.md](./05-control-plane-protocol.md)
   - Gateway ↔ Scheduler 控制面协议（命令/事件/流式）
6. [06-runtime-flows.md](./06-runtime-flows.md)
   - 关键运行时顺序（文本时序图）
7. [07-migration-plan.md](./07-migration-plan.md)
   - 分阶段迁移计划、回滚策略、兼容策略
8. [08-risk-and-observability.md](./08-risk-and-observability.md)
   - 风险清单、指标、告警、审计
9. [09-acceptance-criteria.md](./09-acceptance-criteria.md)
   - 验收标准（功能、一致性、实时性、安全性）

## 与 As-Is 的映射

- As-Is 问题入口：`docs/refine/flow/README.md`
- 本目录每篇文档都明确对应一个或多个问题点，确保“问题 -> 方案 -> 迁移 -> 验收”闭环。
