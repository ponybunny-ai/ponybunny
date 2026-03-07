# Step 09 - 回环、重试与阻塞点

## 目标

识别系统在运行时会“回到之前步骤”的机制，并给出链接。

## 回环 A：Scheduler tick 回环

1. 位置
   - `src/scheduler/core/scheduler.ts` 的 `tick()`

2. 机制
   - `setInterval` 周期执行
   - 每轮遍历 `activeGoals` 调 `processGoal(goalId)`

3. 回到的步骤
   - 每次 tick 都回到 [Step 06](./step-06-daemon-ipc-and-scheduler.md) 的“SchedulerCore 处理流程”。

4. 常见阻塞返回点
   - blocking escalation
   - budget exceeded
   - no ready work item

## 回环 B：ReAct 执行循环

1. 位置
   - `src/autonomy/react-integration.ts::executeWorkCycle`

2. 机制
   - `while (!completed && maxIterations > 0)`
   - 无动作/空响应会触发“立即调用一个具体工具”的强提示，然后进入下一轮

3. 回到的步骤
   - 回到 [Step 07](./step-07-execution-tools.md) 的“每轮工具选择与调用”。

## 回环 C：执行失败后的自动重试

1. 位置
   - `src/scheduler/core/scheduler.ts::handleExecutionFailure`

2. 分支
   - `retryHandler.decideRetry(...)`
   - `shouldRetry=true` 且非 escalate 时：work item 置回 `queued`

3. 回到的步骤
   - 重新进入 [Step 06](./step-06-daemon-ipc-and-scheduler.md)（tick 下一轮再次选 item 并执行）。

4. 注意
   - 自动重试路径未见显式增加 `retry_count`；
   - 手动 `workitem.retry` 会增加 `retry_count`（gateway handler）。

## 回环 D：网络连接重连

1. TUI WS 客户端重连
   - `src/cli/gateway/gateway-client.ts::scheduleReconnect`

2. IPC 客户端重连
   - `src/ipc/ipc-client.ts` 在 close 后 `scheduleReconnect`

3. 回到的步骤
   - 重连成功后分别回到：
     - [Step 02](./step-02-input-routing.md)（TUI 正常交互）
     - [Step 06](./step-06-daemon-ipc-and-scheduler.md)（daemon 与 gateway 恢复命令/事件通道）

## 回环 E：会话澄清回环

1. 位置
   - `conversation-state-machine` 可能进入 `clarifying`

2. 机制
   - 用户补充信息后再次提交，重新触发输入分析

3. 回到的步骤
   - 返回 [Step 03](./step-03-session-first-conversation.md) 重新走 `analyze -> determineNextState`。

## 下一步

- 进入 [Step 10](./step-10-scenario-simulation-result.md) 看这个具体场景在当前实现下的模拟运行结论。
