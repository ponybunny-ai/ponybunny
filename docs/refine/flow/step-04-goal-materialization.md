# Step 04 - Goal / WorkItem 物化（落库）

## 目标

梳理本场景文本如何从 conversation 分析结果变成可执行目标对象。

## 控制流

1. `SessionManager.handleExecuting(...)`
   - 文件：`src/app/conversation/session-manager.ts`
   - 关键：
     - 将 analysis 组装为 `requirements`
     - 调 `taskBridge.createGoalFromConversation(requirements, session, sourceTurnId)`

2. `TaskBridge.createGoalFromConversation(...)`
   - 文件：`src/app/conversation/task-bridge.ts`
   - 关键步骤：
     1) `repository.createGoal(...)`
        - `status: 'queued'`
        - `context.createdViaConversation=true`
        - 写入 `sessionId/turnId/personaId`
     2) 读取当前 scheduler（`this.getScheduler()`）
     3) 如果 scheduler 存在：`setImmediate(() => scheduler.submitGoal(goal))`
     4) 返回 `{ goalId, workItems }`（此处 `workItems` 是读取当前库内结果，可能为空）

3. SessionManager 回填 session
   - `session.activeGoalId = result.goalId`
   - `sessionRepository.updateSession(session)`
   - 之后生成 “已开始执行” 的对话回复文本

## 数据流

1. Goal 数据来源
   - title/description/successCriteria/priority 来自 analysis 的 purpose + emotion

2. Goal context
   - `createdViaConversation: true`
   - `sessionId` / `turnId`
   - 这使该 goal 与会话产生数据关联

3. Work item
   - 在 conversation 路径中，`TaskBridge` 本身不创建 work item；返回前只是 `getWorkItemsByGoal(goal.id)` 查询。
   - 当前实现中 SchedulerCore 也不会“自动生成 work item”。
   - 若某个 goal 被 scheduler 处理时 work item 为空，`areAllWorkItemsComplete(goalId)` 会返回 true，
     该 goal 会被直接走完成分支（`goal_completed`），而不是进入执行链路。

## 与 fast-path 的差异

- fast-path（`goal.submit` RPC）在 Gateway `goal-handlers` 中显式 `createWorkItem(...)`，并且 `session.subscribeToGoal(goal.id)`。
- session-first 通过 `TaskBridge` 直接落库 goal，不经过 `goal.submit` handler。

## 关键影响

- 这意味着：session-first 创建出的 goal，如果没有额外 work item 物化步骤，
  即使后续被 submit 到 scheduler，也可能表现为“快速完成而非实际执行工具任务”。

## 下一步

- 进入 [Step 05](./step-05-dispatch-paths.md)：这里是本场景最关键分叉——session-first 与 daemon 调度的衔接问题。
