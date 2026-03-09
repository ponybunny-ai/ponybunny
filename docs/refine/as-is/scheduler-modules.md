# Scheduler / Scheduler Daemon 模块梳理（当前代码）

## 1. 入口与进程边界

### 1.1 Scheduler Daemon CLI 入口

- 文件：`src/cli/commands/scheduler-daemon.ts`
- 关键调用：
  - `runScheduler(...)`
  - `new SchedulerDaemon(repository, executionService, llmProvider, config)`
  - `await daemon.start()`

### 1.2 Scheduler Daemon 运行时

- 文件：`src/scheduler-daemon/daemon.ts`
- 角色：独立进程中的调度执行中枢，负责：
  - 构建 `SchedulerCore`
  - 连接 Gateway IPC socket
  - 转发 scheduler/debug 事件到 Gateway
  - 接收 Gateway 下发命令（submit/cancel/apply_runtime_rollout）

## 2. SchedulerCore 构建关系

### 2.1 Factory 组装

- 文件：`src/gateway/integration/scheduler-factory.ts`

`createScheduler(...)` 内直接创建并装配：

- `SchedulerRepositoryAdapter`
- `ExecutionEngineAdapter`
- `ModelSelector`
- `LaneSelector`
- `BudgetTracker`
- `RetryHandler`
- `WorkItemManager`
- `EscalationHandler`
- `QualityGateRunner`

最终返回：`new SchedulerCore(schedulerDeps, schedulerConfig)`。

### 2.2 SchedulerCore 导出

- `src/scheduler/core/index.ts` 导出 `SchedulerCore`
- `src/scheduler/index.ts` 聚合导出 scheduler 所有子模块类型和实现

## 3. SchedulerCore 主调用链

文件：`src/scheduler/core/scheduler.ts`

### 3.1 生命周期方法

- `start()`：启动 tick interval
- `pause()` / `resume()`：暂停与恢复 tick loop
- `stop()`：清理 timer、中止 active execution
- `submitGoal(goal)`：注册 goal state + `goal_started` 事件
- `cancelGoal(goalId)`：中止对应 run + 更新状态

### 3.2 Tick 链路

1. `tick()`
2. 对 active goals 调 `processGoal(goalId)`
3. `processGoal`：
   - 读 goal
   - 检查 blocking escalations / budget
   - 判断是否全部完成
   - `workItemManager.getNextWorkItem(goalId)`
   - 进入 `startWorkItemExecution(...)`

### 3.3 WorkItem 执行链路

`startWorkItemExecution(...)`：

- `modelSelector.selectModel(...)`
- `laneSelector.selectLane(...)`
- `repository.createRun(...)`
- `workItemManager.updateStatus(..., 'in_progress')`
- emit：`work_item_started` / `run_started` / `work_item_in_progress`
- 异步触发 `executeWorkItem(context)`

`executeWorkItem(...)`：

- `executionEngine.execute(workItem, {...})`
- `budgetTracker.recordUsage(...)`
- `repository.completeRun(...)`
- emit：`run_completed`
- success 分支：`handleExecutionSuccess(...)`
- failure 分支：`handleExecutionFailure(...)`

`handleExecutionSuccess(...)`：

- `workItemManager.updateStatus(..., 'verify')`
- emit：`verification_started` + `work_item_in_progress(stage=verification)`
- `qualityGateRunner.runVerification(...)`
- emit：`verification_completed`
- 通过则 `workItemManager.updateStatus(..., 'done')` + emit `work_item_completed/work_item_ended`
- 否则走 `handleExecutionFailure(...)`

`handleExecutionFailure(...)`：

- emit：`work_item_ended(outcome=failure)`
- `retryHandler.decideRetry(...)`
  - escalate：`escalationHandler.createEscalation(...)` + `workItemManager.updateStatus(...,'blocked')` + emit `escalation_created`
  - retry queue：`workItemManager.updateStatus(...,'queued')`
  - fail terminal：`workItemManager.updateStatus(...,'failed')` + goal 设为 blocked + emit `work_item_failed/goal_failed`

## 4. SchedulerDaemon 与 IPC 调用链

文件：`src/scheduler-daemon/daemon.ts`

### 4.1 启动阶段

1. `repository.initialize()`
2. 加载 agent registry + reconcile cron jobs
3. `await ipcClient.connect()`（连接 Gateway IPCServer）
4. `this.scheduler = createScheduler(...)`
5. `this.scheduler.on((event) => this.handleSchedulerEvent(event))`
6. `await this.scheduler.start()`
7. `recoverQueuedGoals()`
8. （可选）开启 AgentScheduler loop + run event retention loop

### 4.2 事件上行（daemon → gateway）

- `handleSchedulerEvent(event)`
  - `ipcClient.send({ type: 'scheduler_event', data: event })`
- `handleDebugEvent(event)`
  - `ipcClient.send({ type: 'debug_event', data: event })`

### 4.3 指令下行（gateway → daemon）

- `ipcClient.onMessage(...)` → `handleIPCMessage`
- 仅处理 `type === 'scheduler_command'`
- `handleSchedulerCommand(command)` 支持：
  - `submit_goal` → `repository.getGoal` + `scheduler.submitGoal(goal)`
  - `cancel_goal` → `scheduler.cancelGoal(goalId)`
  - `apply_runtime_rollout` → `scheduler.applyRuntimeRollout(rollout)`
- 结果回传：`sendSchedulerCommandResult(requestId, success, error?)`

## 5. AgentScheduler（cron 调度）

文件：`src/scheduler-daemon/agent-scheduler.ts`

`dispatchOnce(...)` 关键链路：

1. `repository.claimDueCronJobs(...)`
2. 读取 agent 定义并 `computeScheduleOutcome(...)`
3. `getOrCreateCronJobRun(...)`
4. 创建 goal + workItem（context.kind=`agent_tick`）
5. `repository.updateWorkItemStatus(..., 'ready')`
6. `scheduler.submitGoal(goal)`
7. 通过 `handleSchedulerEvent(goal_completed/goal_failed)` 回写 cron run 状态

## 6. 当前实现注意点

1. SchedulerCore 的构建入口位于 `gateway/integration/scheduler-factory.ts`，
   这是当前 daemon 进程中实际使用的装配器。
2. runtime rollout 的最终生效在 daemon 侧通过 `scheduler.applyRuntimeRollout(...)` 执行。
3. 当前主运行模式是 daemon 进程调度，不是 gateway 进程内直接调度。
