# 03. Scheduler Intake 与决策引擎设计

## 1) 目标

把“用户会话输入 -> 意图识别 -> 执行决策 -> goal/workitem 物化”的整条链路统一放到 Scheduler 进程。

## 2) 统一入口

新增 Scheduler 控制面方法（由 Gateway 转发）：

- `scheduler.session.open`
- `scheduler.session.resume`
- `scheduler.session.message`（核心）
- `scheduler.session.end`

其中 `scheduler.session.message` 支持：
- non-stream response
- stream response（chunk + final decision）

## 3) 决策流程（在 Scheduler 内）

1. 读取/创建会话
2. 调用 `IInputAnalysisService.analyze(input, contextTurns)`
3. 决策器根据 analysis 产物判定：
   - `response_only`
   - `clarification_requested`
   - `goal_created`
4. 若 `goal_created`：
   - 必须同时生成 >=1 workitem（满足 Executable Goal Invariant）
   - 再提交到 SchedulerCore
5. 输出决策结果 + 事件（会话事件 + goal/workitem/run 事件）

## 4) 与当前问题的一一对应

1. 修复“session-first 到 scheduler 断链”
   - 通过 `scheduler.session.message` 内部直接完成 create+submit。

2. 修复“空 workitem 直接 completed”
   - 在 intake 层强制保证 `goal_created => workItems.length >= 1`。

3. 修复“路径依赖导致体验不一致”
   - 不再由 TUI/Gateway 决定 fast-path，统一由分析+决策输出。

## 5) 组件建议

在 scheduler-daemon 内新增（逻辑分层，不要求目录立即一致）：

- `SessionIntakeService`
- `IntakeDecisionEngine`
- `GoalMaterializer`
- `SessionEventPublisher`

其中：
- `SessionIntakeService` 持有 `IInputAnalysisService`。
- `GoalMaterializer` 只做“把决策转成 Goal/WorkItem 并 submit”。

## 6) 输出契约（对 Gateway）

`scheduler.session.message` 最终返回：

- `sessionId`
- `decision` (`goal_created | clarification_requested | response_only`)
- `decisionReason`
- `response`（对话文本）
- `taskInfo?`（若 goal_created）

并保证若 `taskInfo.goalId` 存在，则该 goal 已经满足可执行条件并进入调度。
