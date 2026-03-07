# 系统运行流分析（数据流 + 控制流）

场景输入（TUI）：

> 我想知道后天London是否下雨。写一个shell脚本来实现这个功能，并且将脚本保存到当前用户的home目录下，运行后给我最终的结果。

本目录按运行步骤拆分当前代码的真实执行顺序，并标注关键分支与回环。

## 目录

1. [step-01-init.md](./step-01-init.md) - 进程与运行时初始化
2. [step-02-input-routing.md](./step-02-input-routing.md) - TUI 输入到命令/自然语言路由
3. [step-03-session-first-conversation.md](./step-03-session-first-conversation.md) - session-first 会话链路
4. [step-04-goal-materialization.md](./step-04-goal-materialization.md) - Goal/WorkItem 落库与任务抽象
5. [step-05-dispatch-paths.md](./step-05-dispatch-paths.md) - 调度下发分支（in-proc vs daemon IPC）
6. [step-06-daemon-ipc-and-scheduler.md](./step-06-daemon-ipc-and-scheduler.md) - daemon IPC 与 SchedulerCore 执行序
7. [step-07-execution-tools.md](./step-07-execution-tools.md) - 执行层 ReAct/tool 调用序
8. [step-08-event-return-path.md](./step-08-event-return-path.md) - 事件回流到 TUI 的路径
9. [step-09-loops-retries.md](./step-09-loops-retries.md) - 回环、重试、阻塞点
10. [step-10-scenario-simulation-result.md](./step-10-scenario-simulation-result.md) - 场景模拟结果（基于当前代码）

## 阅读建议

- 若关注“为什么前端没进度更新”，先看 [step-05-dispatch-paths.md](./step-05-dispatch-paths.md) 与 [step-08-event-return-path.md](./step-08-event-return-path.md)。
- 若关注“脚本写入与执行发生在哪里”，先看 [step-07-execution-tools.md](./step-07-execution-tools.md)。

## 本次分析发现的问题点（关联步骤）

1. **session-first 到 daemon 的提交链路不闭合**
   - `TaskBridge.createGoalFromConversation` 仅尝试 in-proc scheduler，不走 IPC fallback，导致 goal 创建后不保证立刻进入 daemon 调度。
   - 关联步骤：
     - [step-04-goal-materialization.md](./step-04-goal-materialization.md)
     - [step-05-dispatch-paths.md](./step-05-dispatch-paths.md)
     - [step-10-scenario-simulation-result.md](./step-10-scenario-simulation-result.md)

2. **queued goal 的恢复仅在 daemon 启动时一次性执行**
   - `recoverQueuedGoals()` 不是持续轮询机制，因此不能替代“创建后即时 submit”。
   - 关联步骤：
     - [step-05-dispatch-paths.md](./step-05-dispatch-paths.md)
     - [step-06-daemon-ipc-and-scheduler.md](./step-06-daemon-ipc-and-scheduler.md)
     - [step-10-scenario-simulation-result.md](./step-10-scenario-simulation-result.md)

3. **session-first goal 在无 work item 时可能被直接 completed**
   - 当前实现下，若 goal 被 scheduler 处理时 work item 数量为 0，会被判定为 all complete，无法进入“查天气/写脚本/执行脚本”执行链。
   - 关联步骤：
     - [step-04-goal-materialization.md](./step-04-goal-materialization.md)
     - [step-05-dispatch-paths.md](./step-05-dispatch-paths.md)
     - [step-10-scenario-simulation-result.md](./step-10-scenario-simulation-result.md)

4. **事件可见性依赖 goal 订阅，session-first 路径默认不自动订阅**
   - 大多数事件按 `goalId` 定向广播到订阅者；`goal.submit` 会自动 `subscribeToGoal`，但 session-first 不经过该路径。
   - 关联步骤：
     - [step-05-dispatch-paths.md](./step-05-dispatch-paths.md)
     - [step-08-event-return-path.md](./step-08-event-return-path.md)
     - [step-10-scenario-simulation-result.md](./step-10-scenario-simulation-result.md)

5. **TUI 输入模式分流与配置字段语义存在偏差**
   - 当前分流点主要依据 `goalSubmitFastPathEnabled`；`sessionFirstEnabled` 字段存在但不直接决定该分流。
   - 关联步骤：
     - [step-01-init.md](./step-01-init.md)
     - [step-02-input-routing.md](./step-02-input-routing.md)
