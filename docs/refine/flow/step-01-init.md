# Step 01 - 进程初始化与运行时基线

## 目标

建立本次分析所依赖的运行时事实：TUI、Gateway、SchedulerDaemon 三者如何启动，以及默认输入模式是什么。

## 控制流

1. TUI 启动
   - `src/cli/index.ts` 默认 action 调 `startTui(...)`
   - `src/cli/tui/start.ts` 调 `render(React.createElement(App, ...))`

2. Gateway 启动（独立进程）
   - `src/cli/commands/gateway.ts` 中 `runGateway(...)`
   - 注释明确：`// Create and start gateway (no scheduler - runs independently)`
   - 实际：`new GatewayServer(...)` + `await gateway.start()`

3. SchedulerDaemon 启动（独立进程）
   - `src/cli/commands/scheduler-daemon.ts` 的 `runScheduler(...)`
   - `new SchedulerDaemon(...)` + `await daemon.start()`

## 数据流

1. runtime config 载入
   - `src/infra/config/runtime-config.ts`
   - 默认值：
     - `tui.sessionFirstEnabled = true`
     - `tui.goalSubmitFastPathEnabled = false`

2. IPC socket 基线
   - 默认 socket：`~/.ponybunny/gateway.sock`
   - Gateway 使用 `IPCServer(socketPath)`
   - SchedulerDaemon 使用 `IPCClient(socketPath)`

## 本步结论

- 默认配置值是：`goalSubmitFastPathEnabled=false`、`sessionFirstEnabled=true`。
- **当前 TUI 输入分流实际只看 `goalSubmitFastPathEnabled`**（见 Step 02），
  并不是由 `sessionFirstEnabled` 直接决定。
- Gateway 与 Scheduler 默认是分进程，通过 IPC 通信。

## 下一步

- 进入 [Step 02](./step-02-input-routing.md)：从 TUI 输入框提交开始，跟踪命令路由和自然语言入口函数。
