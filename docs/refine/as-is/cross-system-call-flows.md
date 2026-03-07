# 跨系统依赖与调用关系（Gateway / Scheduler / TUI）

本文件聚焦三个子系统之间的“直接调用链”与“事件回流链”。

---

## 1. 启动链路

### 1.1 主 TUI 启动

1. `src/cli/index.ts` 默认 action
2. `startTui(...)`（`src/cli/tui/start.ts`）
3. `<App>`（`src/cli/tui/app.tsx`）
4. `GatewayProvider.connect()` 建立到 Gateway 的 WebSocket

### 1.2 Gateway 启动（独立进程）

1. `pb gateway start` → `src/cli/commands/gateway.ts`
2. `runGateway(...)`
3. `new GatewayServer(...)`
4. `gateway.start()`：
   - 启动 WS Server
   - 启动 IPCServer
   - `ipcBridge.connect(ipcServer)`

### 1.3 Scheduler Daemon 启动（独立进程）

1. `pb scheduler start` → `src/cli/commands/scheduler-daemon.ts`
2. `runScheduler(...)`
3. `new SchedulerDaemon(...)`
4. `daemon.start()`：
   - `ipcClient.connect()`
   - `createScheduler(...)` 创建 `SchedulerCore`
   - `scheduler.start()`

---

## 2. TUI → Gateway 的调用链

## 2.1 通用 RPC 调用链

1. TUI 业务代码（view/command/hook）调用 `TuiGatewayClient.<method>`
2. `TuiGatewayClient` 转为 `GatewayClient.request('rpc.method', params)`
3. `GatewayClient` 通过 WebSocket 发 `req` frame
4. Gateway `MessageRouter` 解析并路由到 `RpcHandler`
5. 对应 `register*Handlers` 执行业务逻辑并返回 `res` frame

关键文件：
- `src/cli/gateway/tui-gateway-client.ts`
- `src/cli/gateway/gateway-client.ts`
- `src/gateway/protocol/message-router.ts`
- `src/gateway/rpc/rpc-handler.ts`

## 2.2 典型例子：自然语言提交（session-first）

1. `handleNaturalInput(...)`（`src/cli/tui/commands/handlers.ts`）
2. 若无 active session：`createConversationSession()`
3. `sendConversationMessage()`
4. 若返回 `taskInfo.goalId`：TUI 将目标标记为 processing，并等待后续事件回流更新

## 2.3 典型例子：自然语言提交（fast-path）

1. `handleNaturalInputFastPath(...)`
2. 直接 `submitGoal(...)`
3. 进入 Gateway `goal.submit` handler，创建 goal/work item 并下发调度

---

## 3. Gateway → Scheduler 的调用链（当前主路径）

> 当前 CLI 启动模式下，主路径是 **Gateway IPCServer ↔ SchedulerDaemon IPCClient**。

## 3.1 goal.submit 下发调度

1. Gateway `goal.submit`（`goal-handlers.ts`）创建 goal/work item
2. 调度分支：
   - 若进程内 scheduler 存在：`scheduler.submitGoal(goal)`
   - 否则若 daemon 已连接：`remoteSchedulerClient.submitGoal(goal.id)`
3. `remoteSchedulerClient` 实际为 `IPCBridge`
4. `IPCBridge.sendSchedulerCommand('submit_goal', ...)`
5. SchedulerDaemon `handleIPCMessage` → `handleSchedulerCommand`
6. Daemon 内部执行：`scheduler.submitGoal(goal)`

关键文件：
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/gateway/gateway-server.ts`
- `src/gateway/integration/ipc-bridge.ts`
- `src/scheduler-daemon/daemon.ts`

## 3.2 cancel/apply rollout 下发

- `goal.cancel` → IPC `cancel_goal`
- `system.runtime.rollout.update` → IPC `apply_runtime_rollout`
- daemon 收到命令后调用：`scheduler.cancelGoal(...)` / `scheduler.applyRuntimeRollout(...)`

---

## 4. Scheduler → Gateway → TUI 的事件回流链

## 4.1 daemon 侧发事件

1. `SchedulerCore` 在执行流程中 `emitEvent(...)`
2. `SchedulerDaemon` 通过 `scheduler.on(...)` 监听
3. `handleSchedulerEvent(event)` 发 IPC 消息：`type='scheduler_event'`

## 4.2 gateway 侧收事件

1. `IPCServer` 收到消息
2. `IPCBridge.handleSchedulerEvent(...)` 将 scheduler event 映射为 gateway event
3. `eventBus.emit('goal.started'|'workitem.*'|'run.*'|...)`
4. `BroadcastManager` / `EventEmitter` 将事件推送给 WS 客户端

## 4.3 TUI 侧消费事件

1. `GatewayClient.onEvent`
2. `GatewayProvider.onEvent`
3. `AppWithEventHandler.handleEvent(event)`
4. 更新 `goals/workItems/escalations/simpleMessages/events` 等状态

关键文件：
- `src/scheduler/core/scheduler.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/gateway/integration/ipc-bridge.ts`
- `src/gateway/events/broadcast-manager.ts`
- `src/cli/tui/app.tsx`

---

## 5. “进程内 bridge” 与 “IPC bridge” 的关系

代码中有两类 bridge：

1. `SchedulerBridge`（`src/gateway/integration/scheduler-bridge.ts`）
   - 用于 Gateway 与进程内 `ISchedulerCore` 直连
2. `IPCBridge`（`src/gateway/integration/ipc-bridge.ts`）
   - 用于 Gateway 与独立 `scheduler-daemon` 进程通信

当前 CLI 运行主路径以 IPCBridge 为主。

---

## 6. 关系总览（文字图）

1. **主 TUI 请求链**
   - TUI Component/Command → `TuiGatewayClient` → `GatewayClient` → Gateway RPC handler

2. **调度下发链**
   - Gateway `goal.submit/cancel/rollout` handler → `IPCBridge` → SchedulerDaemon command handler → `SchedulerCore`

3. **执行事件回流链**
   - `SchedulerCore.emitEvent` → SchedulerDaemon IPC send → Gateway `IPCBridge` event map → Gateway EventBus broadcast → TUI event handler

4. **状态呈现链**
   - TUI `AppWithEventHandler` 更新 `AppContext` → 视图（Dashboard/Goals/Tasks/Sessions）重渲染
