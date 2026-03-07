# Gateway 模块梳理（当前代码）

## 1. 入口与装配

### 1.1 CLI 入口（进程启动）

- 文件：`src/cli/commands/gateway.ts`
- 关键调用：
  - `runGateway(...)` 中创建 `GatewayServer`
  - `await gateway.start()` 启动 WebSocket + IPC

直接依赖（CLI → Gateway）：
- `import { GatewayServer } from '../../gateway/index.js'`
- `import { WorkOrderDatabase } from '../../work-order/database/manager.js'`

### 1.2 Gateway 导出面

- 文件：`src/gateway/index.ts`
- 暴露：`GatewayServer`、`MessageRouter`、`RpcHandler`、`SchedulerBridge`、`createScheduler` 等。

## 2. GatewayServer 组件图（构造阶段）

文件：`src/gateway/gateway-server.ts`

`GatewayServer` 在构造函数内创建并持有：

- 连接与协议层
  - `ConnectionManager`
  - `AuthManager`
  - `RpcHandler`
  - `MessageRouter`
- 事件层
  - `EventBus`
  - `EventEmitter`
  - `BroadcastManager`
- 集成桥接层
  - `DaemonBridge`
  - `SchedulerBridge`（进程内 scheduler 事件桥）
  - `IPCServer`
  - `IPCBridge`（与 scheduler-daemon 通信）
- 业务服务层
  - `AuditLogRepository` + `AuditService`
  - conversation 相关：`SessionManager`、`PersonaEngine`、`ResponseGenerator` 等
  - tools 相关：`ToolRegistry` + `ToolAllowlist` + `ToolEnforcer`

## 3. RPC 注册关系（GatewayServer.registerHandlers）

文件：`src/gateway/gateway-server.ts`

`registerHandlers()` 中直接注册：

- `registerGoalHandlers(...)`
- `registerWorkItemHandlers(...)`
- `registerEscalationHandlers(...)`
- `registerApprovalHandlers(...)`
- `registerDebugHandlers(...)`
- `registerConversationHandlers(...)`
- `registerPersonaHandlers(...)`
- `registerAuditHandlers(...)`
- `registerSystemHandlers(...)`
- `registerInternalRuntimeHandlers(...)`

并额外注册：
- `system.ping`
- `system.methods`
- `system.stats`

## 4. 协议与路由调用链

### 4.1 WS 入站调用

文件：`src/gateway/gateway-server.ts`、`src/gateway/protocol/message-router.ts`

链路：
1. `GatewayServer.start()` 后 `wss.on('connection', ...)`
2. `handleConnection` 内 `ws.on('message', ...)`
3. 调 `messageRouter.handleMessage(ws, data)`
4. `MessageRouter.handleRequest(...)`
   - `auth.*` → `AuthManager`
   - `system.ping/system.info` → public handler
   - 其他方法需 session，之后调用 `rpcHandler.handle(method, params, session)`

### 4.2 RPC 执行

文件：`src/gateway/rpc/rpc-handler.ts`

链路：
1. `RpcHandler.handle(method, params, session)`
2. `MethodRegistry.execute(...)`
3. 实际 handler（各 `rpc/handlers/*.ts`）执行

## 5. 关键 handler 的直接调用关系

### 5.1 goal-handlers

文件：`src/gateway/rpc/handlers/goal-handlers.ts`

- `goal.submit`
  - `repository.createGoal(...)`
  - `repository.createWorkItem(...)`
  - `eventBus.emit('goal.created', ...)`
  - 调度提交（二选一）：
    - 进程内：`scheduler.submitGoal(goal)`
    - daemon：`remoteSchedulerClient.submitGoal(goal.id)`（来自 `IPCBridge`）
- `goal.cancel`
  - `repository.updateGoalStatus(..., 'cancelled')`
  - 调度取消：`scheduler.cancelGoal(...)` 或 `remoteSchedulerClient.cancelGoal(...)`
  - `eventBus.emit('goal.cancelled', ...)`

### 5.2 escalation-handlers

文件：`src/gateway/rpc/handlers/escalation-handlers.ts`

- `escalation.respond`
  - `repository.resolveEscalation(...)`
  - 若 action 触发 resume，会 `createWorkItem` + `updateWorkItemStatus('ready')` + `updateGoalStatus('queued')`
  - 然后再次提交 goal（进程内 scheduler 或 remote daemon）
  - `eventBus.emit('escalation.resolved' / 'escalation.retry_scheduled')`

### 5.3 conversation-handlers

文件：`src/gateway/rpc/handlers/conversation-handlers.ts`

- `conversation.new` → `sessionManager.createSession(...)` + `eventBus.emit('conversation.new')`
- `conversation.message`
  - 非流式：`sessionManager.processMessage(...)`
  - 流式：`sessionManager.processMessageWithStream(...)`
  - 分别发出 `conversation.response`、`conversation.message.succeeded`、`conversation.stream.*`

### 5.4 workitem-handlers

文件：`src/gateway/rpc/handlers/workitem-handlers.ts`

- `workitem.list/get/byGoal/runs/retry`
- `workitem.retry` 直接改 repo 状态：`incrementWorkItemRetry` + `updateWorkItemStatus('queued')` + `updateGoalStatus('queued')`

### 5.5 system/internal runtime handlers

- 文件：`src/gateway/rpc/handlers/system-handlers.ts`
  - `system.capabilities`
  - `system.status`
  - `system.runtime.rollout.status/update`
  - `system.runtime.tui.update`
  - `system.agent.model_hint.set`
- 文件：`src/gateway/rpc/handlers/internal-runtime-handlers.ts`
  - `internal.runtime.config`
  - `internal.plan.*`
  - `internal.run.*`
  - `internal.runs.events/replay/timeline/events.prune`

## 6. 事件广播与桥接

### 6.1 EventBus → 客户端广播

文件：`src/gateway/events/broadcast-manager.ts`、`src/gateway/events/event-emitter.ts`

- `BroadcastManager` 订阅 `EventBus` 事件
- `EventEmitter` 通过 `ConnectionManager` 广播到会话/订阅目标

### 6.2 Scheduler 事件桥（两套）

- 进程内桥：`src/gateway/integration/scheduler-bridge.ts`
  - `scheduler.on(event)` → 映射后 `eventBus.emit(...)`
- IPC 桥：`src/gateway/integration/ipc-bridge.ts`
  - 接收 IPC `scheduler_event` → 映射后 `eventBus.emit(...)`

当前主路径（按 CLI 启动方式）主要依赖 IPC 桥，因为 `gateway` 与 `scheduler-daemon` 默认独立进程。

## 7. 需要在阅读时注意的当前实现细节

1. `GatewayServer.connectScheduler()` / `SchedulerBridge`（进程内连接）在代码中存在，
   但按当前 CLI 启动路径（`pb gateway start` + `pb scheduler start`）默认不是主链路。
2. `system.capabilities` 的 `schedulerConnected` 来自 `getScheduler() !== null`（进程内 scheduler 判断），
   不等于 IPC daemon 连通性。
3. IPC daemon 连通性由 `IPCBridge.isSchedulerDaemonConnected()` 单独维护，并用于 `goal.submit/cancel` 等远端命令发送。
