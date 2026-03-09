# Step 06 - SchedulerDaemon IPC 与 SchedulerCore 执行顺序

## 目标

描述 daemon 模式下，从 gateway 发出 `submit_goal` 到 scheduler 开始执行的完整控制链。

## 控制流

1. Gateway 启动时
   - `gateway.start()` 内：`ipcServer.start()` 后 `ipcBridge.connect(ipcServer)`
   - 文件：`src/gateway/gateway-server.ts`

2. SchedulerDaemon 启动时
   - `ipcClient.connect()` 连接 gateway socket
   - `this.scheduler = createScheduler(...)`
   - `this.scheduler.on((event) => this.handleSchedulerEvent(event))`
   - `await this.scheduler.start()`
   - 文件：`src/scheduler-daemon/daemon.ts`

3. Gateway 下发命令
   - `IPCBridge.sendSchedulerCommand('submit_goal', {goalId})`
   - 内部找 `clientType==='scheduler-daemon'` 的 IPC client
   - 发送 `type='scheduler_command'`

4. Daemon 收命令
   - `ipcClient.onMessage` -> `handleIPCMessage`
   - 仅处理 `message.type==='scheduler_command'`
   - `handleSchedulerCommand` 分支到 `submit_goal`
   - `repository.getGoal(goalId)` 后执行 `scheduler.submitGoal(goal)`
   - 返回 `scheduler_command_result(success=true)`

5. SchedulerCore 进入 active
   - `submitGoal(goal)` 将 goal 注册到 `state.activeGoals`
   - emit `goal_started`

## 数据流

1. IPC message 样式
   - command：`{ type:'scheduler_command', data:{ requestId, command:'submit_goal', goalId } }`
   - result：`{ type:'scheduler_command_result', data:{ requestId, success, error? } }`

2. Scheduler state
   - `goalStates[goalId]` 初始化为 pending
   - activeGoals 加入该 goalId

## 回环

1. Tick loop
   - `SchedulerCore.start()` -> `setInterval(tick)`
   - 每次 tick 遍历 `activeGoals`，逐个 `processGoal(goalId)`

2. 如果此时工作项未 ready 或被 escalation 阻塞，会在 tick 中反复返回同一处理点。
   - 回到 [Step 09](./step-09-loops-retries.md) 查看细节。

## 下一步

- 进入 [Step 07](./step-07-execution-tools.md)：当 `processGoal` 选中 work item 后，如何调用工具完成“查天气+写脚本+运行脚本”。
