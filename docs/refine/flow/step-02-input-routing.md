# Step 02 - TUI 输入路由（命令 vs 自然语言）

## 目标

确定用户输入文本从 UI 进入系统后的第一个控制分支。

## 控制流

1. `AppContent.handleInputSubmit(input)`
   - 文件：`src/cli/tui/app.tsx`
   - 逻辑：
     - 空输入直接返回
     - 先记录输入历史 `app.addToInputHistory(input)`

2. 第一层分支：slash command 还是自然语言
   - `isCommand(input)` 为 true：`executeCommand(input, commandContext)`
   - 否则：`handleNaturalInput(input, commandContext)`

3. 本场景输入不是 slash 命令，因此进入 `handleNaturalInput`
   - 文件：`src/cli/tui/commands/handlers.ts`

## 数据流

1. `handleNaturalInput` 读取：
   - `ctx.gateway.client`
   - `ctx.app.state.runtimeTuiConfig`
   - 若本地无 runtime 配置，则调用 `client.getInternalRuntimeConfig()`

2. 模式判定关键字段：
   - `useFastPath = runtimeConfig.goalSubmitFastPathEnabled`

3. 本场景默认（见 Step 01）
   - `goalSubmitFastPathEnabled=false`
   - 因此进入 **session-first** 分支

## 本步结论

- 场景文本不会走 `executeCommand`，会进入自然语言处理。
- 该自然语言处理是否“直接提交 goal”，当前实现由 `goalSubmitFastPathEnabled` 控制。
- `sessionFirstEnabled` 虽在 runtime config 中存在，但在这个分流点没有被直接读取作为判定条件。

## 下一步

- 进入 [Step 03](./step-03-session-first-conversation.md)：跟踪 session-first 的 conversation RPC 链路。
