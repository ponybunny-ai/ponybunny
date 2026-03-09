# Gateway / Scheduler / TUI 代码梳理（当前状态）

本目录用于记录 **当前 codebase 实际实现**（非设计目标）的模块结构、直接依赖关系与调用关系。

> 范围：`src/gateway`、`src/scheduler`、`src/scheduler-daemon`、`src/cli/tui`、`src/cli/debug-tui`、`src/cli/gateway` 及其直接相关 CLI 入口。

## 文档目录

- [gateway-modules.md](./gateway-modules.md)
  - Gateway 组件分层
  - RPC 注册与处理链路
  - Gateway 内部依赖关系（EventBus/IPC/Bridge）
- [scheduler-modules.md](./scheduler-modules.md)
  - SchedulerCore 调度主循环
  - SchedulerDaemon（独立进程）与 IPC 指令处理
  - scheduler 子模块（model/lane/budget/retry/workitem/escalation/quality gate）
- [tui-modules.md](./tui-modules.md)
  - 主 TUI（Ink）模块与组件
  - Slash command 与自然语言输入链路
  - Debug TUI 模块
- [cross-system-call-flows.md](./cross-system-call-flows.md)
  - Gateway ↔ Scheduler 的关键调用流
  - TUI ↔ Gateway 的关键调用流
  - 事件广播与状态更新流

## 说明

1. 文档仅反映当前仓库代码状态，不推测未来架构。
2. “直接依赖”按显式 `import`、构造注入、直接方法调用记录。
3. “调用链”以入口函数和关键方法为主，尽量给出文件与方法名定位。
