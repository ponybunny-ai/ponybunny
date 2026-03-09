# Step 08 - 事件回流路径（Scheduler -> Gateway -> TUI）

## 目标

说明执行阶段产生的事件如何回到 TUI，驱动用户可见的状态变化。

## 控制流

1. Scheduler 事件发出
   - `SchedulerCore.emitEvent(event)`
   - 典型：`work_item_started`、`run_started`、`run_completed`、`verification_completed`、`goal_completed` 等

2. Daemon 转发到 Gateway
   - `SchedulerDaemon.handleSchedulerEvent` -> `ipcClient.send({ type:'scheduler_event', data:event })`

3. Gateway IPCBridge 映射
   - `IPCBridge.handleSchedulerEvent`
   - 将 scheduler event 映射为 gateway eventBus event：
     - `goal_started -> goal.started`
     - `run_completed -> run.completed`
     - `work_item_in_progress -> workitem.in_progress`
     - ...

4. BroadcastManager 广播
   - `BroadcastManager.start()` 订阅 eventBus
   - `broadcastEvent`：
     - 若 payload 中有 `goalId`，走 `emitToGoalSubscribers(goalId, ...)`
     - 否则走 `broadcastToPermission(..., 'read')`

5. TUI 客户端接收
   - `GatewayClient.handleMessage` 收到 `type='event'` 后回调 `onEvent`
   - `GatewayProvider` 把事件传给 `AppWithEventHandler.handleEvent`

6. TUI 状态更新
   - `app.tsx` 内 switch(event.event) 更新：
     - `goal.*` 更新 message status（Queued/Executing/Completed/Failed）
     - `workitem.started/in_progress/ended` 更新时间线
     - `run.completed` 后调用 `client.getWorkItemRuns(workItemId)` 回拉 run 输出摘要
     - `verification.completed` 写入 summary

## 数据流

1. 回流事件载荷示例
   - `run.completed`：`{ goalId, workItemId, runId, success, selectedModel, actualModel, endpointId }`
   - `verification.completed`：`{ goalId, workItemId, runId, passed, summary }`

2. TUI 的最终可见结果来源
   - 一部分来自事件 payload
   - 一部分来自 run 详情拉取（`workitem.runs`）后提取 execution log/summary

## 关键注意点

1. 目标订阅依赖
   - 由于大多数事件携带 `goalId`，广播是“按 goal 订阅定向发送”。
   - 若当前会话未订阅该 goal，TUI 可能看不到进度。

2. 在 `goal.submit` 路径中会 `session.subscribeToGoal(goal.id)`；
   conversation session-first 路径默认不经过该逻辑。

## 下一步

- 进入 [Step 09](./step-09-loops-retries.md) 看系统何时回到前一步（tick 回环、重试回环、连接重连回环）。
