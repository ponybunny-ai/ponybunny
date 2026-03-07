# Step 05 - 调度下发分支（in-proc vs daemon IPC）

## 目标

明确“Goal 已创建”之后，控制流如何（或没有）进入 Scheduler。

## 分支 A：session-first（conversation -> TaskBridge）

1. 代码路径
   - `SessionManager.handleExecuting` -> `TaskBridge.createGoalFromConversation`

2. 调度条件
   - `TaskBridge` 仅在 `getScheduler() !== null` 时执行：
     - `setImmediate(() => scheduler.submitGoal(goal))`
   - 若 `getScheduler() === null`，不会走 IPC fallback。

3. 关键影响
   - 在“Gateway 与 SchedulerDaemon 分进程”的常见运行方式下，`GatewayServer.scheduler` 通常为空，
     session-first 创建出的 goal 可能只停留在 queued（或依赖其他机制拉起）。
   - 当前已存在的“其他机制”是 daemon 启动时的 `recoverQueuedGoals()`：
     它会一次性扫描 `status='queued'` goals 并调用 `scheduler.submitGoal(goal)`。
   - 该恢复逻辑不是持续轮询，因此不等价于“每次 session-first 创建都立即下发”。

## 分支 B：fast-path（goal.submit RPC）

1. 代码路径
   - `handleNaturalInputFastPath` -> `TuiGatewayClient.submitGoal` -> RPC `goal.submit`

2. Gateway `goal.submit` 行为
   - 文件：`src/gateway/rpc/handlers/goal-handlers.ts`
   - 顺序：
     1) `createGoal(...)`
     2) `createWorkItem(...)`
     3) `session.subscribeToGoal(goal.id)`
     4) `eventBus.emit('goal.created', ...)`
     5) 调度提交：
        - in-proc: `scheduler.submitGoal(goal)`
        - daemon: `remoteSchedulerClient.submitGoal(goal.id)`（即 IPCBridge）

3. 这条路径是 daemon 场景下稳定进入调度的主路径。

## 分支 C：in-proc scheduler（如果显式 connectScheduler）

1. `GatewayServer.connectScheduler(scheduler)` 可将 scheduler 挂到 Gateway 内部。
2. 这种情况下，TaskBridge 和 goal-handlers 都可直接调用 `scheduler.submitGoal(...)`。
3. 但 CLI 标准启动注释显示 gateway 默认“no scheduler - runs independently”。

## 与下一步关系

- 若走分支 B（daemon IPC），进入 [Step 06](./step-06-daemon-ipc-and-scheduler.md)。
- 若走分支 A 且无 in-proc scheduler，通常会在此形成“执行停滞”；
  可跳转 [Step 10](./step-10-scenario-simulation-result.md) 查看该场景的模拟结论。

## 额外说明（与 Step 04 联动）

- 即使 queued goal 被 daemon 启动恢复后 submit，若该 goal 下没有 work item，
  scheduler 会把它判定为“所有工作项已完成”，直接完成 goal。
- 详见 [Step 04](./step-04-goal-materialization.md)。
