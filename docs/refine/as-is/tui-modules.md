# TUI 模块梳理（当前代码）

## 1. 主 TUI 入口与根组件

### 1.1 入口

- CLI 默认入口：`src/cli/index.ts`
  - 默认 action 调 `startTui({ url, token })`
- TUI 启动：`src/cli/tui/start.ts`
  - `render(React.createElement(App, { url, token }), ...)`

### 1.2 根组件装配

- 文件：`src/cli/tui/app.tsx`
- 根结构：
  - `<AppProvider initialUrl={url}>`
  - `<GatewayProvider url token ...>`
  - `<AppContent />`

## 2. 状态层（AppContext）

文件：`src/cli/tui/context/app-context.tsx`

### 2.1 状态来源

- `useReducer(appReducer, initialState)`
- `state` 定义：`src/cli/tui/store/types.ts`
- reducer：`src/cli/tui/store/reducer.ts`

### 2.2 关键状态域

- 页面与弹窗：`currentView`, `activeModal`, `modalData`
- 连接与运行：`connectionStatus`, `gatewayUrl`, `activityStatus`
- 业务数据：`sessions`, `goals`, `workItems`, `escalations`, `schedulerCapabilities`
- 时间线与事件：`simpleMessages`, `events`
- 运行时诊断：`runtimeSnapshots`, `runtimeTuiConfig`
- 输入状态：`inputValue`, `inputHistory`, `inputFocused`

### 2.3 事件缓冲

- `addEvent(...)` 先写入 `pendingEventsRef`
- 50ms 定时 flush 后批量 `dispatch(actions.addEvents(...))`

## 3. 网关连接层（GatewayContext）

文件：`src/cli/tui/context/gateway-context.tsx`

- `connect()` 创建 `new TuiGatewayClient({ url, token })`
- 注册回调：`onConnected/onDisconnected/onEvent/onError`
- `client.start()` 发起连接
- provider 卸载时 `disconnect()` → `client.stop()`

客户端类型：
- 高层：`src/cli/gateway/tui-gateway-client.ts`
- 低层：`src/cli/gateway/gateway-client.ts`（WebSocket + RPC request/response + auth）

## 4. App 初始化调用链（连接后）

文件：`src/cli/tui/app.tsx`（`useEffect` 监听 `gateway.connectionStatus`）

连接成功后首次加载：

1. `client.listConversationSessions(...)` → `app.setSessions(...)`
2. `client.listGoals(...)` → `app.setGoals(...)`
3. `client.listEscalations()` → `app.setEscalations(...)`
4. `client.listWorkItems()` → `app.setWorkItems(...)`
5. `client.getSystemCapabilities()` → `app.setSchedulerCapabilities(...)`
6. `client.getInternalRuntimeConfig()` → `app.setRuntimeTuiConfig(runtime.tui)`

## 5. 输入路由：Slash 命令 vs 自然语言

文件：`src/cli/tui/app.tsx`、`src/cli/tui/commands/handlers.ts`

### 5.1 总入口

- `AppContent.handleInputSubmit(input)`：
  - `isCommand(input)` 为真 → `executeCommand(input, commandContext)`
  - 否则 → `handleNaturalInput(input, commandContext)`

### 5.2 Slash command 执行

- `executeCommand` 定义：`handlers.ts`
  - `parseCommand` + `findCommand`
  - alias 归一化
  - 命中 `handlers[canonicalName]`

常见命令调用点：
- `/refresh` → `refreshSchedulerData` 或 `refreshRuntimeData`
- `/models` → 打开 model selector，选择后 `setMainAgentModelHint(...)`
- `/rollout` → `getRuntimeRolloutStatus/updateRuntimeRollout`
- `/replay`、`/pruneevents` → internal runtime 相关 RPC
- `/sessions`、`/use`、`/archive-session`、`/resume-session` → conversation 会话管理 RPC

### 5.3 自然语言执行

- `handleNaturalInput` 根据 `runtimeTuiConfig.goalSubmitFastPathEnabled` 分流：
  - fast-path：`handleNaturalInputFastPath(...)` 直接 `submitGoal`
  - session-first：`createConversationSession`（必要时）+ `sendConversationMessage`

## 6. 事件回流：Gateway 事件 → UI 状态更新

文件：`src/cli/tui/app.tsx`（`AppWithEventHandler.handleEvent`）

总链路：
1. GatewayProvider 收到 `client.onEvent`
2. 进入 `handleEvent(event)`
3. 先 `addEvent(event.event, data)`
4. 按 event type 更新状态：
   - `goal.*`：add/update/remove goal + simple message 时间线
   - `workitem.*` / `run.*` / `verification.*`：更新 work item/run 相关显示
   - `conversation.*`：刷新 session 列表和 active session
   - `escalation.*`：更新 escalation 列表与关联消息

## 7. 主视图组件关系

视图导出：`src/cli/tui/components/views/index.ts`

### 7.1 DashboardView

- 文件：`src/cli/tui/components/views/dashboard-view.tsx`
- 依赖：`useAppContext`, `useGatewayContext`, `useGoals`, `useTerminalSize`
- 关键调用：`gateway.client.getConversationHistory(activeSessionId, limit)`

### 7.2 GoalsView

- 文件：`src/cli/tui/components/views/goals-view.tsx`
- 关键调用：
  - retry：`client.submitGoal(...)`
  - delete：`client.deleteGoal(goalId)`
- 直接状态操作：`removeGoal`、`removeSimpleMessage`、`setWorkItems(...)`

### 7.3 WorkstreamView / TasksView

- 文件：`src/cli/tui/components/views/tasks-view.tsx`
- 关键调用：
  - `gateway.client.getWorkItemRuns(workItemId)`
  - retry：`client.submitGoal(...)`
  - delete：`client.deleteGoal(goalId)`
- 同时展示 `runtimeSnapshots`（runtime diagnostics）

### 7.4 SessionsView

- 文件：`src/cli/tui/components/views/sessions-view.tsx`
- 关键调用：
  - `listConversationSessions`
  - `getConversationHistory`
  - `archiveConversationSession`
  - `resumeConversationSession`

### 7.5 EventsView / HelpView

- EventsView：事件本地过滤与展示，不直接请求 gateway
- HelpView：静态帮助内容

## 8. Modal 组件关系

模态导出：`src/cli/tui/components/modals/index.ts`

- `GoalCreateModal`：`useGateway().submitGoal(...)`
- `EscalationModal`：`useGateway().resolveEscalation(...)`
- `CommandPaletteModal`：触发命令执行回调
- `ModelSelectorModal`：选择模型后回调（持久化通常在 `/models` handler 执行）
- `ViewSwitcherModal`：切换 `ViewType`
- `ConfirmModal`：执行注入的确认回调

## 9. Debug TUI（独立于主 TUI 的另一套）

### 9.1 入口

- 命令入口：`src/cli/commands/debug.ts`（`pb debug tui`）
- 启动：`src/cli/debug-tui/index.ts`（`startDebugTui`）
- 根组件：`src/cli/debug-tui/app.tsx`

### 9.2 状态与调用

- 状态上下文：`src/cli/debug-tui/context.tsx`
- 使用客户端：`GatewayClient`（不是 `TuiGatewayClient`）
- 典型 RPC：
  - `debug.snapshot`
  - `debug.scheduler`
  - `debug.lanes`
  - `debug.goals`
  - `debug.gateway`
  - `debug.events`
  - `debug.events.subscribe`
  - `system.capabilities`

## 10. 当前实现注意点

1. 主 TUI 与 Debug TUI 是两套 UI/runtime 管线，二者共享 Gateway 但状态上下文独立。
2. 主 TUI 的核心状态更新由 `AppWithEventHandler.handleEvent` 驱动（事件回流模型），
   不仅依赖命令请求结果。
3. 自然语言输入模式由 runtime 配置动态控制（`session-first` / `fast-path`）。
