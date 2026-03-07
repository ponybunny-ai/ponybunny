# Step 10 - 场景模拟结论（当前代码）

场景：

> 我想知道后天London是否下雨。写一个shell脚本来实现这个功能，并且将脚本保存到当前用户的home目录下，运行后给我最终的结果。

## 模拟前提

1. 使用默认 runtime（`goalSubmitFastPathEnabled=false`）
2. Gateway 与 SchedulerDaemon 分进程运行（CLI 常见模式）
3. TUI 通过 WebSocket 接入 Gateway

## 预期逻辑目标（语义层）

从语义上，系统需要完成：

1. 查询 London 后天天气（雨/不雨）
2. 生成 shell 脚本
3. 脚本写到用户 home 目录
4. 执行脚本
5. 返回最终结果

这在执行层对应工具组合通常为：`web_search` / MCP 搜索 + `write_file` + `execute_command`（见 [Step 07](./step-07-execution-tools.md)）。

## 按当前代码的实际运行结果（默认配置）

### 结果 A：session-first 默认路径

1. 输入会进入 `handleNaturalInput` 的 session-first 分支。
2. conversation.message 经过 SessionManager 后，可能创建 goal 并返回 `taskInfo.goalId`。
3. 但该 goal 来自 `TaskBridge.createGoalFromConversation`，只会尝试 in-proc scheduler；
   在 daemon 模式下没有 IPC fallback submit。
4. daemon 启动时会执行 `recoverQueuedGoals()`，会一次性把 queued goals submit；
   但这不是持续提交机制，因此不保证“创建后立即执行”。
5. 同时，session-first 路径不经过 `goal.submit` handler，不会自动 `session.subscribeToGoal(goal.id)`，
   即便后续被执行，TUI 也可能接收不到大部分带 goalId 的进度事件。
6. 并且 session-first 目标在当前实现里可能没有 work item；这类 goal 一旦被 scheduler 处理，
   会因“work item 数量为 0 视为 all complete”直接进入 goal completed，而不会触发工具执行链路。

**结论**：默认 session-first 下，这个场景在当前实现中存在两层风险：
1) 创建后不一定立即下发到 daemon；
2) 即便被恢复 submit，也可能因无 work item 而直接 completed，无法实现“查天气+写脚本+执行脚本”的目标执行链。

### 结果 B：fast-path 路径（对照）

若切到 fast-path（`goalSubmitFastPathEnabled=true`）：

1. TUI 直接走 `goal.submit` RPC。
2. Gateway `goal.submit` 会：createGoal + createWorkItem + subscribeToGoal + IPC submit_goal。
3. SchedulerDaemon 收到命令后启动 SchedulerCore 执行。
4. 执行层可调用 `web_search` + `write_file` + `execute_command`。
5. 事件通过 IPCBridge/BroadcastManager 回流，TUI 可看到执行进度和结果。

**结论**：该场景要稳定落地“写脚本并运行拿到最终结果”，当前代码更依赖 fast-path。

## 数据流快照（当前实现）

1. 输入文本（TUI）
2. `conversation.message`（session-first）或 `goal.submit`（fast-path）
3. Goal / WorkItem / Run（repository 持久化）
4. Scheduler event（goal/workitem/run/verification）
5. Gateway EventBus -> Broadcast -> TUI state/timeline

## 关键风险点清单

1. session-first 与 daemon submit 链路不闭合（TaskBridge 缺 IPC fallback）。
2. 目标订阅依赖使事件可见性与路径强绑定（`goal.submit` 才自动订阅）。
3. 自动重试路径可能反复回环（见 [Step 09](./step-09-loops-retries.md)）。

## 回链

- 若要看“这个风险从哪一步产生”：回到 [Step 05](./step-05-dispatch-paths.md)
- 若要看“执行完成后结果如何展示”：回到 [Step 08](./step-08-event-return-path.md)
