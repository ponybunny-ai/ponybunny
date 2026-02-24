# Agent System Redesign 实现评估（2026-02-23）

本文档对 `docs/agents/agent-system-redesign-2026-02-23.md` 的原始需求逐条对照当前实现，评估完成度、证据和剩余差距。

## 评估范围

- 对照原文档第 1-7 条架构与功能要求
- 覆盖本轮已落地代码（含未提交工作区变更）
- 给出完成度分级：`已完成` / `部分完成` / `未完成`

## 总体结论

- 当前重构已建立可运行主链路，核心能力已落地：主 Agent 单实例运行、`pb agent` 命令集、可选 persona、OS 权限生命周期、subagent 进程生命周期、每 Agent 独立 workdir。
- 最新回归后，`agent_tick` 默认执行路径已经切换到既有 ReAct 执行链，并新增了用户命令入口（`agent.command.submit`）进入同一调度体系。
- 仍有关键缺口：按 Agent 粒度的 skills/mcp 精细装配、人类审批的可回放状态机、以及“专用 runner”与 ReAct 的统一策略。

## 逐条对照评估

### 1) 每个 runtime 只运行一个主 Agent（默认 lead）

状态：`已完成`

证据：

- 运行时配置新增主 Agent 字段并默认 `lead`：`src/infra/config/runtime-config.ts`
- scheduler CLI 支持 `--main-agent` 并读取 runtime 默认：`src/cli/commands/scheduler-daemon.ts`
- daemon 启动时解析主 Agent 并只 reconcile 主 Agent：`src/scheduler-daemon/daemon.ts`
- reconcile 支持 `mainAgentId` 过滤：`src/infra/scheduler/cron-job-reconciler.ts`

评语：与原需求一致，且有缺省回退逻辑。

### 2) 增加 `pb agent` 命令集（list/use/customize/status）

状态：`已完成`

证据：

- 新命令注册：`src/cli/index.ts`
- 命令实现：`src/cli/commands/agent.ts`
  - `list`：列 system/user agent
  - `use`：更新 main agent 到 `~/.config/ponybunny/ponybunny.json` 并重启 scheduler
  - `customize`：复制 system agent 到 `~/.config/ponybunny/agents/<id>`
  - `status`：展示当前状态与 user/system 差异路径

评语：功能覆盖完整，满足文档描述。

### 3) scheduler 启动后按配置加载 Agent，并增加 human-in-loop

状态：`部分完成`

证据（已完成部分）：

- daemon 启动先加载 Agent registry，并完成 cron reconcile：`src/scheduler-daemon/daemon.ts`
- 后续调度由 AgentScheduler + runner 处理：`src/scheduler-daemon/agent-scheduler.ts`、`src/infra/agents/schema-driven-agent-runner.ts`
- 新增用户命令入口并进入调度：`src/gateway/rpc/handlers/goal-handlers.ts` (`agent.command.submit`)

证据（未完全完成部分）：

- human-in-loop 目前主要体现在 OS 权限申请/授权链（请求后阻断并等待授权）：`src/infra/agents/schema-driven-agent-runner.ts`、`src/gateway/rpc/handlers/os-permission-handlers.ts`
- 通用审批门禁已有基础（`approval_required` 会创建 escalation 并阻断执行）：`src/app/lifecycle/execution/execution-service.ts`
- 新增 escalation 响应后的恢复执行链：`escalation.respond` 在 `retry` 时会创建携带 `approval_granted=true` 的新 work item 并重新提交 goal：`src/gateway/rpc/handlers/escalation-handlers.ts`
- 仍缺更细粒度的审批阶段模型（例如多级审批、审批过期和撤销策略）。

评语：调度主链完成；human-in-loop 仍需扩展到通用任务审批与人工指令回流。

### 4.1) Agent 同时支持 cron 与人类指令任务

状态：`已完成`

证据：

- cron 路径已完整：`src/scheduler-daemon/agent-scheduler.ts`
- routeContext 在 agent_tick 中已可透传并归一：`src/infra/agents/agent-tick-context.ts`、`src/gateway/integration/execution-engine-adapter.ts`
- 新增人类命令路径：`src/gateway/rpc/handlers/goal-handlers.ts` 中 `agent.command.submit`

评语：cron 和人类命令已可并存，并进入同一调度执行链。

### 4.2) 按 Agent 配置按需加载 skills/mcp/tools

状态：`部分完成`

证据：

- runner 内有 allowlist/denylist/forbiddenPatterns 计算 `effectiveTools`：`src/infra/agents/schema-driven-agent-runner.ts`

新增进展：

- cron 与人类命令创建的 `agent_tick` 都写入 `tool_allowlist`，并由 ExecutionService 的 scoped ToolEnforcer 强制执行：`src/scheduler-daemon/agent-scheduler.ts`、`src/gateway/rpc/handlers/goal-handlers.ts`、`src/app/lifecycle/execution/execution-service.ts`

差距：

- skills 与 MCP 仍主要是全局初始化，尚未实现“每个 Agent 独立装配/隔离加载”的完整生命周期。

评语：tools 约束已进入执行面；skills/MCP 还需按 Agent 收敛。

### 4.3) 支持 subagent 自动启动（spawn 新进程，带 parent id，支持兜底关闭）

状态：`已完成`

证据：

- subagent 进程管理器：`src/infra/agents/subagent-process-manager.ts`
  - `fork` 子进程、发送 `init`、等待 `ready`
  - 传递 `PONY_PARENT_AGENT_ID` 等上下文
  - `shutdown -> shutdown_ack` 优雅关闭，超时走 `SIGTERM/SIGKILL`
- 协议与 worker：`src/infra/agents/subagent-protocol.ts`、`src/infra/agents/subagent-worker.ts`
- runner 集成启动与回收：`src/infra/agents/schema-driven-agent-runner.ts`

评语：已满足文档要求，并额外补了 heartbeat 监控与僵尸清理。

### 4.4) 复用现有 ReAct 循环，不重复发明执行引擎

状态：`部分完成`

证据：

- `agent_tick` 默认执行路径已改为通过 `ExecutionService.executeWorkItem`，复用既有 `ReActIntegration`：`src/gateway/integration/execution-engine-adapter.ts`
- 专用 runner（如 `market_listener` 或显式 runner）仍可走自定义路径：`src/gateway/integration/execution-engine-adapter.ts`

评语：主路径已对齐 ReAct，剩余差异集中在专用 runner 策略统一。

### 4.5) 支持 persona（可开关）

状态：`已完成`

证据：

- runtime config 增加 `agent.personaEnabled`：`src/infra/config/runtime-config.ts`
- scheduler CLI 暴露 `--persona`：`src/cli/commands/scheduler-daemon.ts`
- runner 在启用时注入 persona system prompt：`src/infra/agents/schema-driven-agent-runner.ts`

评语：满足需求，开关行为明确。

### 6) OS 权限申请、使用、管理、取消

状态：`部分完成`

证据：

- runner 支持按 `runner.config.os_permissions` 进行权限检查/申请：`src/infra/agents/schema-driven-agent-runner.ts`
- 权限 RPC 与 repository/checker 基础设施可用：`src/gateway/rpc/handlers/os-permission-handlers.ts`、`src/infra/permission/os-service-checker.ts`
- 执行结束后自动 revoke goal 权限：`src/infra/agents/schema-driven-agent-runner.ts`

差距：

- 目前权限申请与业务阶段执行的联动还偏“请求-阻断-重试”模型，缺更细粒度的阶段级授权状态机与审计联动。

评语：基础闭环已建成，可用但仍需产品化增强。

### 7) 每个 Agent 有自己的 work dir

状态：`已完成`

证据：

- workdir 解析与自动创建：`src/infra/agents/agent-workdir.ts`
- Agent schema/config 增加 `workdir`：`docs/schemas/agent.schema.json`、`src/infra/agents/config/agent-config-types.ts`
- 调度写入 `agent_workdir` 到 tick context：`src/scheduler-daemon/agent-scheduler.ts`
- 执行链透传 `workDir`：`src/infra/agents/agent-tick-context.ts`、`src/gateway/integration/execution-engine-adapter.ts`、`src/infra/agents/schema-driven-agent-runner.ts`

评语：需求已实现，默认与自定义路径均可用。

## 完成度汇总

- 已完成：6 项（1, 2, 4.1, 4.3, 4.5, 7）
- 部分完成：4 项（3, 4.2, 4.4, 6）
- 未完成：0 项

## 风险与优先级建议

### P0（建议立即推进）

1. 明确专用 runner 与 ReAct 的统一策略（哪些必须走 ReAct、哪些可旁路、如何审计）。
2. 在审批恢复链上补充多级审批和审批过期策略，避免无限重试/误恢复。

### P1（建议下一批）

1. 将 skills/MCP 从全局初始化改为按 Agent 配置装配，并做到可审计。
2. 将 OS 权限从“请求阻断”升级为阶段级授权状态机（含更强审计）。

### P2（增强项）

1. 将 subagent heartbeat 上报到 daemon/gateway 事件流，完善观测面。
2. 增加针对心跳与进程回收的集成测试（非仅单元测试）。
